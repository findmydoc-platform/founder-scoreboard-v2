import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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

test("webhook recovery uses one Vercel Cron Job and no GitHub Actions worker", async () => {
  const config = JSON.parse(await readFile("vercel.json", "utf8"));
  assert.deepEqual(config.crons, [{
    path: "/api/maintenance/github-webhooks",
    schedule: "*/5 * * * *",
  }]);
  await assert.rejects(access(".github/workflows/process-github-webhooks.yml"), { code: "ENOENT" });
  await assert.rejects(access(".github/scripts/maintenance/process-github-webhooks.sh"), { code: "ENOENT" });
});

test("webhook recovery declares its Vercel Cron credential for operators", async () => {
  const [environmentExample, deploymentGuide] = await Promise.all([
    readFile(".env.example", "utf8"),
    readFile("docs/vercel-deployment.md", "utf8"),
  ]);
  assert.match(environmentExample, /^CRON_SECRET=$/m);
  assert.match(deploymentGuide, /^CRON_SECRET=$/m);
});

test("Cron authentication accepts only the configured bearer credential", async () => {
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "cron-test-secret";
  try {
    const auth = await loadTranspiledModule("src/lib/maintenance-auth.ts", {});
    assert.equal(auth.hasCronSecret(), true);
    assert.equal(auth.validateCronSecret("Bearer cron-test-secret"), true);
    assert.equal(auth.validateCronSecret("bearer cron-test-secret"), true);
    assert.equal(auth.validateCronSecret("cron-test-secret"), false);
    assert.equal(auth.validateCronSecret("Bearer different-secret"), false);
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});

function maintenanceQueueSupabase({
  planningTerminalReasons = [],
  commentTerminalReasons = [],
  projectionTerminalReasons = [],
  planningArchivedReasons = [],
  commentArchivedReasons = [],
  outstanding = { planning: 2, comments: 4, projection: 6 },
} = {}) {
  const deliveryRows = {
    github_planning_webhook_deliveries: [
      ...planningTerminalReasons.map((row) => ({ ...row, archived_at: null })),
      ...planningArchivedReasons.map((row) => ({ ...row, archived_at: "2026-08-18T09:00:00Z" })),
    ],
    github_webhook_deliveries: [
      ...commentTerminalReasons.map((row) => ({ ...row, archived_at: null })),
      ...commentArchivedReasons.map((row) => ({ ...row, archived_at: "2026-08-18T09:00:00Z" })),
    ],
    planning_github_projection_outbox: projectionTerminalReasons,
  };
  const outstandingByTable = {
    github_planning_webhook_deliveries: outstanding.planning,
    github_webhook_deliveries: outstanding.comments,
    planning_github_projection_outbox: outstanding.projection,
  };
  return {
    from(table) {
      let selectedColumns = "";
      const filters = [];
      const builder = {
        select: (columns) => { selectedColumns = columns; return builder; },
        eq: (column, value) => { filters.push(["eq", column, value]); return builder; },
        in: (column, value) => { filters.push(["in", column, value]); return builder; },
        is: (column, value) => { filters.push(["is", column, value]); return builder; },
        not: (column, operator, value) => { filters.push(["not", column, operator, value]); return builder; },
        then(resolve) {
          const rows = (deliveryRows[table] || []).filter((row) => filters.every(([method, column, first, second]) => {
            if (column !== "archived_at") return true;
            if (method === "is") return row.archived_at === first;
            if (method === "not" && first === "is" && second === null) return row.archived_at !== null;
            return true;
          }));
          const result = selectedColumns === "status_reason"
            ? { data: rows.map((row) => ({ status_reason: row.status_reason })), error: null }
            : selectedColumns === "archive_reason"
              ? { data: rows.map((row) => ({ archive_reason: row.archive_reason })), error: null }
              : { count: outstandingByTable[table], error: null };
          return Promise.resolve(result).then(resolve);
        },
      };
      return builder;
    },
  };
}

async function loadCronMaintenanceRoute({ supabase, deliveries }) {
  return loadTranspiledModule("src/app/api/maintenance/github-webhooks/route.ts", {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    "@/lib/api-response": {
      apiError: (message, status) => ({ body: { message }, status }),
      supabaseUnavailable: () => ({ status: 503 }),
    },
    "@/lib/github-webhook-drain": {
      drainGitHubWebhookDeliveries: async () => deliveries,
    },
    "@/lib/maintenance-auth": {
      hasCronSecret: () => true,
      validateCronSecret: () => true,
    },
    "@/lib/supabase-service-role": {
      getServerServiceRoleSupabase: () => supabase,
    },
  });
}

function emptyDeliveries({ projectionFailed = 0 } = {}) {
  return {
    projection: { claimed: projectionFailed, completed: 0, retryScheduled: 0, failed: projectionFailed },
    planning: { claimed: 0, processed: 0, ignored: 0, retryScheduled: 0, failed: 0, skipped: 0 },
    comments: { claimed: 0, processed: 0, ignored: 0, retryScheduled: 0, failed: 0, skipped: 0 },
  };
}

test("Cron maintenance exposes only grouped terminal failure reasons and fails visibly", async () => {
  const route = await loadCronMaintenanceRoute({
    supabase: maintenanceQueueSupabase({
      planningTerminalReasons: [{ status_reason: "ambiguous_task_mapping" }],
      commentTerminalReasons: [
        { status_reason: "processing_error" },
        { status_reason: "processing_error" },
        { status_reason: "source_record_missing" },
      ],
      projectionTerminalReasons: [
        { status_reason: "github_sync_unavailable" },
        { status_reason: "github_sync_unavailable" },
        { status_reason: "github_sync_unavailable" },
        { status_reason: "processing_error" },
        { status_reason: "processing_error" },
      ],
      planningArchivedReasons: [{ archive_reason: "superseded_test_failure_task_links_fixed" }],
      commentArchivedReasons: [{ archive_reason: "source_comment_unavailable_without_projection" }],
    }),
    deliveries: emptyDeliveries(),
  });

  const response = await route.GET({ headers: new Headers({ authorization: "Bearer cron-test-secret" }) });
  assert.equal(response.status, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.projectionTerminalFailed, 5);
  assert.equal(response.body.projectionDispatchFailed, 0);
  assert.equal(response.body.projectionOutstanding, 6);
  assert.equal(response.body.terminalFailed, 9);
  assert.equal(response.body.archivedTerminalFailed, 2);
  assert.equal(response.body.outstanding, 12);
  assert.deepEqual(response.body.terminalFailureReasons, {
    planning: [{ reason: "ambiguous_task_mapping", count: 1 }],
    comments: [
      { reason: "processing_error", count: 2 },
      { reason: "source_record_missing", count: 1 },
    ],
    projection: [
      { reason: "github_sync_unavailable", count: 3 },
      { reason: "processing_error", count: 2 },
    ],
  });
  assert.deepEqual(response.body.archivedTerminalFailureReasons, {
    planning: [{ reason: "superseded_test_failure_task_links_fixed", count: 1 }],
    comments: [{ reason: "source_comment_unavailable_without_projection", count: 1 }],
    projection: [],
  });
});

test("Cron maintenance reports archived terminal failures without failing the current queue", async () => {
  const route = await loadCronMaintenanceRoute({
    supabase: maintenanceQueueSupabase({
      planningArchivedReasons: [
        { archive_reason: "superseded_test_failure_task_links_fixed" },
        { archive_reason: "superseded_test_failure_task_links_fixed" },
      ],
      commentArchivedReasons: [{ archive_reason: "source_comment_unavailable_without_projection" }],
      outstanding: { planning: 0, comments: 0, projection: 0 },
    }),
    deliveries: emptyDeliveries(),
  });

  const response = await route.GET({ headers: new Headers({ authorization: "Bearer cron-test-secret" }) });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.terminalFailed, 0);
  assert.equal(response.body.archivedTerminalFailed, 3);
  assert.deepEqual(response.body.archivedTerminalFailureReasons, {
    planning: [{ reason: "superseded_test_failure_task_links_fixed", count: 2 }],
    comments: [{ reason: "source_comment_unavailable_without_projection", count: 1 }],
    projection: [],
  });
});

test("Cron maintenance fails visibly when a projection dispatch cannot finalize", async () => {
  const route = await loadCronMaintenanceRoute({
    supabase: maintenanceQueueSupabase({ outstanding: { planning: 0, comments: 0, projection: 1 } }),
    deliveries: emptyDeliveries({ projectionFailed: 1 }),
  });

  const response = await route.GET({ headers: new Headers({ authorization: "Bearer cron-test-secret" }) });
  assert.equal(response.status, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.terminalFailed, 0);
  assert.equal(response.body.archivedTerminalFailed, 0);
  assert.equal(response.body.projectionDispatchFailed, 1);
  assert.deepEqual(response.body.terminalFailureReasons, {
    planning: [],
    comments: [],
    projection: [],
  });
  assert.deepEqual(response.body.archivedTerminalFailureReasons, {
    planning: [],
    comments: [],
    projection: [],
  });
});

test("Cron maintenance rejects missing configuration and invalid credentials", async () => {
  const route = await loadTranspiledModule("src/app/api/maintenance/github-webhooks/route.ts", {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    "@/lib/api-response": {
      apiError: (message, status) => ({ body: { message }, status }),
      supabaseUnavailable: () => ({ status: 503 }),
    },
    "@/lib/github-webhook-drain": {},
    "@/lib/maintenance-auth": {
      hasCronSecret: () => false,
      validateCronSecret: () => false,
    },
    "@/lib/supabase-service-role": {},
  });
  const unavailable = await route.GET({ headers: new Headers() });
  assert.equal(unavailable.status, 503);

  const protectedRoute = await loadTranspiledModule("src/app/api/maintenance/github-webhooks/route.ts", {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    "@/lib/api-response": {
      apiError: (message, status) => ({ body: { message }, status }),
      supabaseUnavailable: () => ({ status: 503 }),
    },
    "@/lib/github-webhook-drain": {},
    "@/lib/maintenance-auth": {
      hasCronSecret: () => true,
      validateCronSecret: () => false,
    },
    "@/lib/supabase-service-role": {},
  });
  const unauthorized = await protectedRoute.GET({ headers: new Headers({ authorization: "Bearer wrong" }) });
  assert.equal(unauthorized.status, 401);
});
