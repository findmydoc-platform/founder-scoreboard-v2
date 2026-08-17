import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const planningCalls = [];
const commentCalls = [];
const projectionCalls = [];

const drain = await loadTranspiledModule("src/lib/github-webhook-drain.ts", {
  "server-only": {},
  "@/features/planning-items/model/planning-items-github-projection": {
    dispatchPlanningGitHubProjections: async ({ limit }) => {
      projectionCalls.push(limit);
      return { claimed: 2, completed: 1, retryScheduled: 1, failed: 0, results: new Map() };
    },
  },
  "./github-planning-webhook": {
    processGitHubPlanningWebhookDelivery: async ({ deliveryId }) => {
      planningCalls.push(deliveryId);
      return deliveryId === "planning-stale"
        ? { kind: "retry_scheduled", reason: "processing_error" }
        : { kind: "processed", reason: "founderops_updated" };
    },
  },
  "./github-issue-comment-webhook": {
    createSupabaseGitHubIssueCommentWebhookStore: () => ({}),
    processGitHubIssueCommentWebhookDelivery: async ({ deliveryId }) => {
      commentCalls.push(deliveryId);
      return { kind: "ignored", reason: "task_not_found" };
    },
  },
});

function queryResult(table, filters) {
  const processing = filters.some(([method, column, value]) => method === "eq" && column === "status" && value === "processing");
  if (table === "github_planning_webhook_deliveries") {
    return processing
      ? [{ delivery_id: "planning-stale", received_at: "2026-08-16T10:01:00Z" }]
      : [{ delivery_id: "planning-ready", received_at: "2026-08-16T10:00:00Z" }];
  }
  return processing ? [] : [{ delivery_id: "comment-ready", received_at: "2026-08-16T10:02:00Z" }];
}

function supabaseFixture() {
  return {
    from(table) {
      const filters = [];
      const builder = {
        select: () => builder,
        eq: (column, value) => { filters.push(["eq", column, value]); return builder; },
        in: (column, value) => { filters.push(["in", column, value]); return builder; },
        lte: (column, value) => { filters.push(["lte", column, value]); return builder; },
        lt: (column, value) => { filters.push(["lt", column, value]); return builder; },
        order: () => builder,
        limit: () => builder,
        then(resolve) {
          return Promise.resolve({ data: queryResult(table, filters), error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

test("maintenance drains ready and stale deliveries through the normal processors", async () => {
  planningCalls.length = 0;
  commentCalls.length = 0;
  projectionCalls.length = 0;
  const result = await drain.drainGitHubWebhookDeliveries({ supabase: supabaseFixture(), limit: 25 });
  assert.deepEqual(projectionCalls, [25]);
  assert.deepEqual(planningCalls, ["planning-ready", "planning-stale"]);
  assert.deepEqual(commentCalls, ["comment-ready"]);
  assert.deepEqual(result, {
    projection: { claimed: 2, completed: 1, retryScheduled: 1, failed: 0 },
    planning: { claimed: 2, processed: 1, ignored: 0, retryScheduled: 1, failed: 0, skipped: 0 },
    comments: { claimed: 1, processed: 0, ignored: 1, retryScheduled: 0, failed: 0, skipped: 0 },
  });
});

test("the production retry path is secret-protected, bounded, and warmed up", async () => {
  const [route, workflow, script] = await Promise.all([
    readFile("src/app/api/maintenance/github-webhooks/route.ts", "utf8"),
    readFile(".github/workflows/process-github-webhooks.yml", "utf8"),
    readFile(".github/scripts/maintenance/process-github-webhooks.sh", "utf8"),
  ]);
  assert.match(route, /validateMaintenanceSecret/);
  assert.match(route, /drainGitHubWebhookDeliveries\(\{ supabase, limit: 25 \}\)/);
  assert.match(workflow, /cron: "\*\/15 \* \* \* \*"/);
  assert.match(workflow, /environment:\s+name: production/);
  assert.match(script, /sleep 45/);
  assert.match(script, /backoffs=\(0 45 90 180\)/);
  assert.match(script, /\/api\/health/);
  assert.match(script, /\/api\/maintenance\/github-webhooks/);
  assert.match(script, /\.projection\.retryScheduled == 0/);
  assert.match(route, /planning_github_projection_outbox/);
  assert.match(route, /projectionTerminalFailed/);
});

test("maintenance health includes webhook-owned projection failures and outstanding work", async () => {
  const countSupabase = {
    from(table) {
      const filters = [];
      const builder = {
        select: () => builder,
        eq: (column, value) => { filters.push([column, value]); return builder; },
        in: (column, value) => { filters.push([column, value]); return builder; },
        then(resolve) {
          const failed = filters.some(([column, value]) => column === "status" && value === "failed");
          const count = table === "planning_github_projection_outbox"
            ? failed ? 5 : 6
            : table === "github_planning_webhook_deliveries"
              ? failed ? 1 : 2
              : failed ? 3 : 4;
          return Promise.resolve({ count, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  const deliveries = {
    projection: { claimed: 1, completed: 1, retryScheduled: 0, failed: 0 },
    planning: { claimed: 0, processed: 0, ignored: 0, retryScheduled: 0, failed: 0, skipped: 0 },
    comments: { claimed: 0, processed: 0, ignored: 0, retryScheduled: 0, failed: 0, skipped: 0 },
  };
  const route = await loadTranspiledModule("src/app/api/maintenance/github-webhooks/route.ts", {
    "next/server": { NextResponse: { json: (body) => ({ body, status: 200 }) } },
    "@/lib/api-response": {
      apiError: (message, status) => ({ body: { message }, status }),
      supabaseUnavailable: () => ({ status: 503 }),
    },
    "@/lib/github-webhook-drain": {
      drainGitHubWebhookDeliveries: async () => deliveries,
    },
    "@/lib/maintenance-auth": {
      FOUNDEROPS_MAINTENANCE_SECRET_HEADER: "x-founderops-maintenance-secret",
      validateMaintenanceSecret: () => true,
    },
    "@/lib/supabase-service-role": {
      getServerServiceRoleSupabase: () => countSupabase,
    },
  });

  const response = await route.POST({ headers: new Headers() });
  assert.equal(response.status, 200);
  assert.equal(response.body.projectionTerminalFailed, 5);
  assert.equal(response.body.projectionOutstanding, 6);
  assert.equal(response.body.terminalFailed, 9);
  assert.equal(response.body.outstanding, 12);
});
