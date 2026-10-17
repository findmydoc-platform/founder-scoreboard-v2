import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
let calls;
let state;
beforeEach(() => {
  vi.resetModules(); calls = []; state = { rotateAfterLifecycleClaim: true, lifecycleJobs: [], providerCalls: [], purge: { busy: false, purgedRoots: 1, purgedTasks: 2, resolvedNotifications: 3, blockedExpiredRoots: 4, hasMore: false } };
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) vi.stubEnv(name, "https://maintenance-data.example.test");
  for (const name of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY"]) vi.stubEnv(name, "synthetic-anon");
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]) vi.stubEnv(name, "synthetic-service");
  vi.stubEnv("FOUNDEROPS_MAINTENANCE_SECRET", "synthetic-maintenance");
  vi.stubEnv("CRON_SECRET", "synthetic-cron");
  vi.stubEnv("FOUNDEROPS_DELIVERY_SECRET", "synthetic-delivery");
  vi.stubEnv("FOUNDEROPS_PLATFORM_RELEASE_TOKEN", "synthetic-release");
  for (const key of ["GITHUB_APP_ID", "GITHUB_APP_INSTALLATION_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_PRIVATE_KEY_PATH"]) vi.stubEnv(key, "");
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.hostname === "api.github.com") {
      if (url.pathname === "/app/installations/7/access_tokens") {
        state.tokenReady?.();
        if (state.tokenGate) await state.tokenGate;
        if (state.reclaimDuringInstallation) state.foreignClaim = true;
        if (state.expireDuringInstallation) vi.setSystemTime(Date.now() + 120000);
        if (state.rotateDuringInstallation) vi.stubEnv("FOUNDEROPS_MAINTENANCE_SECRET", "replacement-maintenance");
        return Response.json({ token: "synthetic-installation", expires_at: new Date(Date.now() + 3600000).toISOString() });
      }
      state.providerCalls.push({ method: request.method, path: url.pathname });
      if (state.fullProjection && url.pathname === "/graphql") {
        const body = await request.json();
        if (body.query.includes("closedByPullRequestsReferences") && state.rotateAfterProjectionProvider) {
          state.projectionProviderConfirmed = true;
          vi.stubEnv("FOUNDEROPS_MAINTENANCE_SECRET", "replacement-maintenance");
        }
        return Response.json({ data: { organization: { projectV2: { id: "project-1", closed: false, fields: { nodes: [] } }, issueFields: { nodes: [] } }, repository: { issue: { id: "issue-7", projectItems: { nodes: [{ id: "item-7", isArchived: false, project: { id: "project-1" } }] }, closedByPullRequestsReferences: { nodes: [] } } }, node: { id: "item-7", project: { id: "project-1" }, content: { id: "issue-7", issueFieldValues: { nodes: [] } }, fieldValues: { nodes: [] } } } });
      }
      if (state.fullProjection && request.method === "GET" && url.pathname.endsWith("/issues/7")) return Response.json({ number: 7, html_url: "https://github.com/findmydoc-platform/management/issues/7", title: "Synthetic projection", body: "<!-- founderops-task-id:projection-task -->", labels: [] });
      if (state.fullProjection && url.pathname.includes("/dependencies/")) return Response.json([]);
      if (request.method === "PATCH") {
        if (!state.issueClosed) state.closeEffects = (state.closeEffects || 0) + 1;
        state.issueClosed = true;
        if (state.lostPatchOnce && !state.lostPatchThrown) { state.lostPatchThrown = true; throw new TypeError("Synthetic lost provider response"); }
        return Response.json({ number: 7, html_url: "https://github.com/findmydoc-platform/management/issues/7" });
      }
      if (url.pathname.endsWith("/comments")) {
        if (state.databaseChangeAfterProvider) vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "replacement-service");
        if (state.rotateAfterProvider) vi.stubEnv("FOUNDEROPS_MAINTENANCE_SECRET", "replacement-maintenance");
        return Response.json([{ id: 11, body: "<!-- founderops-planning-lifecycle:close_not_planned:task-1:2 -->" }]);
      }
      throw new Error("Unexpected synthetic GitHub lifecycle operation.");
    }
    if (url.origin !== "https://maintenance-data.example.test") throw new Error("Unexpected external maintenance protocol.");
    calls.push({ path: url.pathname, method: request.method, query: url.searchParams, body: request.method === "POST" ? await request.json() : null });
    if (url.pathname === "/rest/v1/rpc/claim_planning_github_lifecycle_jobs") {
      if (state.rotateAfterLifecycleClaim) vi.stubEnv("FOUNDEROPS_MAINTENANCE_SECRET", "replacement-maintenance");
      state.claimedJobs = state.lifecycleJobs.map(job => ({ ...job, lock_token: calls.at(-1).body.p_lock_token, locked_at: new Date().toISOString() }));
      return Response.json(state.claimedJobs);
    }
    if (url.pathname === "/rest/v1/rpc/finalize_planning_github_lifecycle_job") {
      const body = calls.at(-1).body;
      if (body.p_succeeded) state.lifecycleJobs = state.lifecycleJobs.filter(job => job.id !== body.p_job_id);
      return Response.json({ id: body.p_job_id, status: body.p_succeeded ? "completed" : "retry_scheduled" });
    }
    if (url.pathname === "/rest/v1/rpc/purge_expired_planning_trash_batch" && state.lostPurgeResponse) { state.purgeEffects = (state.purgeEffects || 0) + 1; throw new TypeError("Synthetic lost purge response"); }
    if (url.pathname === "/rest/v1/rpc/purge_expired_planning_trash_batch") return state.purgeError ? Response.json({ code: "P0001", message: "Sensitive synthetic database detail" }, { status: 400 }) : Response.json(state.purge);
    if (url.pathname === "/rest/v1/rpc/claim_planning_github_projection_requests") {
      state.claimedProjections = (state.projectionJobs || []).map(job => ({ ...job, lock_token: calls.at(-1).body.p_lock_token, locked_at: new Date().toISOString() }));
      return Response.json(state.claimedProjections);
    }
    if (url.pathname === "/rest/v1/rpc/finalize_planning_github_projection_request") return Response.json({ id: calls.at(-1).body.p_request_id, status: "completed" });
    if (url.pathname === "/rest/v1/rpc/try_acquire_github_issue_sync_lock") return Response.json("confirmed-task-lock");
    if (url.pathname === "/rest/v1/rpc/begin_github_issue_sync_transaction_v2") {
      if (state.rotateAfterProjectionBegin) vi.stubEnv("FOUNDEROPS_MAINTENANCE_SECRET", "replacement-maintenance");
      return Response.json({ updated_at: "confirmed-pending-revision" });
    }
    if (url.pathname === "/rest/v1/rpc/release_github_issue_sync_lock") return Response.json(true);
    if (url.pathname === "/rest/v1/rpc/finalize_github_issue_sync_with_pull_requests_v1") return Response.json({ updated_at: "final-revision" });
    if (url.pathname === "/rest/v1/profiles" || url.pathname === "/rest/v1/task_relationship_edges") return Response.json([]);
    if (url.pathname === "/rest/v1/projects") return Response.json({ github_project_owner: "findmydoc-platform", github_project_number: 1, github_mention_team_slug: null });
    if (url.pathname === "/rest/v1/rpc/claim_task_comment_github_deliveries" || url.pathname === "/rest/v1/rpc/claim_task_review_github_deliveries") return Response.json([]);
    if (url.pathname === "/rest/v1/active_tasks") return Response.json({ id: "projection-task", task_type: "deliverable", title: "Synthetic projection", approval_status: "approved", status: "Offen", priority: "P2", updated_at: "original-revision", github_repo: "findmydoc-platform/management", github_issue_number: 7, github_issue_url: "https://github.com/findmydoc-platform/management/issues/7" });
    if (url.pathname === "/rest/v1/tasks") {
      if (state.rotateDuringTaskRead) vi.stubEnv("FOUNDEROPS_MAINTENANCE_SECRET", "replacement-maintenance");
      return Response.json(state.fullProjection && !url.searchParams.has("id") ? [] : { id: "projection-task", trashed_at: state.fullProjection ? null : "2026-10-01T00:00:00Z" });
    }
    if (request.method === "GET" && ["/rest/v1/planning_github_lifecycle_outbox", "/rest/v1/planning_github_projection_outbox"].includes(url.pathname)) {
      const source = url.pathname.endsWith("planning_github_lifecycle_outbox") ? state.claimedJobs : state.claimedProjections;
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      const rows = (source || []).filter(job => (!id || job.id === id) && !state.foreignClaim && !state.foreignIds?.has(job.id));
      return Response.json(request.headers.get("accept")?.includes("vnd.pgrst.object") ? rows[0] || null : rows);
    }
    if (request.method === "HEAD" && ["planning_github_lifecycle_outbox", "planning_github_projection_outbox"].includes(url.pathname.split("/").at(-1))) return new Response(null, { status: state.queueFailure ? 503 : 200, headers: state.queueRange === null ? {} : { "content-range": state.queueRange || "*/0" } });
    throw new Error("Unexpected maintenance data operation.");
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("does not claim new projection work when the maintenance secret changes after the lifecycle claim", async () => {
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
  const response = await POST(new NextRequest("https://app.example.test/api/maintenance/planning-trash/github-lifecycle", { method: "POST", headers: { "x-founderops-maintenance-secret": "synthetic-maintenance" } }));
  expect(calls.filter(call => call.path.endsWith("claim_planning_github_lifecycle_jobs"))).toHaveLength(1);
  expect(calls.filter(call => call.path.endsWith("claim_planning_github_projection_requests"))).toHaveLength(0);
  expect(response.status).toBe(500);
});


it("offers only the bounded non-dry-run purge operation through the public maintenance seam", async () => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "maintenance-request", request: new NextRequest("https://app.example.test/api/maintenance/planning-trash/purge", { method: "POST", headers: { "x-founderops-maintenance-secret": "synthetic-maintenance" } }) }, action: "maintenance.planning-trash.purge", limit: 1000, dryRun: true });
  expect(permission.ok).toBe(true);
  expect(Object.keys(permission).sort()).toEqual(["ok", "planningTrash"]);
  const result = await permission.planningTrash.purge();
  expect(result.error).toBeNull();
  expect(result.data).toEqual(state.purge);
  expect(calls).toEqual([{ path: "/rest/v1/rpc/purge_expired_planning_trash_batch", method: "POST", query: expect.any(URLSearchParams), body: { p_limit: 25, p_dry_run: false } }]);
});


function request(path, headers = { "x-founderops-maintenance-secret": "synthetic-maintenance" }) {
  return new NextRequest(`https://app.example.test/api/maintenance/planning-trash/${path}`, { method: "POST", headers });
}
const entries = ["github-lifecycle", "purge"];
it.each(entries)("rejects missing/wrong and other credential families before any %s work", async entry => {
  const { POST } = await importTestModule(`src/app/api/maintenance/planning-trash/${entry}/route.ts`, { "server-only": {} });
  for (const candidate of ["", "wrong", "synthetic-cron", "synthetic-delivery", "synthetic-release"]) {
    expect((await POST(request(entry, { "x-founderops-maintenance-secret": candidate }))).status).toBe(401);
  }
  expect((await POST(request(entry, { authorization: "Bearer synthetic-maintenance" }))).status).toBe(401);
  expect(calls).toHaveLength(0);
});

it.each(entries)("preserves configured-secret validation before missing dependencies for %s", async entry => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", ""); vi.stubEnv("SUPABASE_SECRET_KEY", "");
  const { POST } = await importTestModule(`src/app/api/maintenance/planning-trash/${entry}/route.ts`, { "server-only": {} });
  expect((await POST(request(entry, {}))).status).toBe(401);
  const response = await POST(request(entry));
  expect(response.status).toBe(501);
  expect(await response.json()).toEqual({ error: "Supabase env is not configured." });
  expect(calls).toHaveLength(0);
});

it("preserves the actual empty lifecycle/projection summaries and exact queue filters", async () => {
  state.rotateAfterLifecycleClaim = false;
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
  const response = await POST(request("github-lifecycle"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, claimed: 0, completed: 0, retryScheduled: 0, failed: 0, errors: [], projection: { claimed: 0, completed: 0, retryScheduled: 0, failed: 0 }, terminalFailed: 0, outstandingLifecycleJobs: 0, outstandingProjectionRequests: 0 });
  expect(calls.filter(call => call.method === "POST").map(call => call.body)).toEqual([{ p_lock_token: expect.any(String), p_limit: 25, p_lease_seconds: 120 }, { p_lock_token: expect.any(String), p_limit: 25, p_lease_seconds: 120, p_operation_id: null }]);
  expect(calls.filter(call => call.method === "HEAD").map(call => [call.path, call.query.get("status")])).toEqual([["/rest/v1/planning_github_lifecycle_outbox", "eq.failed"], ["/rest/v1/planning_github_lifecycle_outbox", "neq.completed"], ["/rest/v1/planning_github_projection_outbox", "neq.completed"]]);
});

it("preserves real purge result parsing, bounded metrics and opaque storage errors", async () => {
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/purge/route.ts", { "server-only": {} });
  const success = await POST(request("purge"));
  expect(success.status).toBe(200);
  expect(await success.json()).toEqual({ ok: true, ...state.purge });
  state.purge = { ...state.purge, purgedRoots: 26 };
  const malformed = await POST(request("purge"));
  expect(malformed.status).toBe(500);
  expect(await malformed.json()).toEqual({ error: "Planungspapierkorb lieferte ein ungültiges Bereinigungsergebnis." });
  state.purgeError = true;
  const failed = await POST(request("purge"));
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ error: "Planungspapierkorb konnte nicht bereinigt werden." });
});

it("returns a failed purge result without dispatch after an issued capability loses its secret", async () => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "maintenance-request", request: request("purge") }, action: "maintenance.planning-trash.purge" });
  expect(permission.ok).toBe(true);
  vi.stubEnv("FOUNDEROPS_MAINTENANCE_SECRET", "replacement-maintenance");
  const result = await permission.planningTrash.purge();
  expect(result.error).not.toBeNull();
  expect(calls).toHaveLength(0);
});


it("rejects a provider effect when the maintenance secret changes while its installation token is awaited", async () => {
  state.rotateAfterLifecycleClaim = false; state.rotateDuringInstallation = true;
  state.lifecycleJobs = [{ id: "a1111111-1111-4111-8111-111111111111", root_type: "deliverable", root_id: "task-1", root_trash_revision: 1, task_id: "task-1", github_repo: "findmydoc-platform/management", github_issue_number: 7, action: "close_not_planned", source_type: "withdrawn", source_revision: 2, status: "processing", attempts: 1 }];
  vi.stubEnv("GITHUB_APP_ID", "5"); vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "7"); vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey);
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
  expect((await POST(request("github-lifecycle"))).status).toBe(500);
  expect(state.providerCalls).toEqual([]);
});


function lifecycleJob() {
  return { id: "a1111111-1111-4111-8111-111111111111", root_type: "deliverable", root_id: "task-1", root_trash_revision: 1, task_id: "task-1", github_repo: "findmydoc-platform/management", github_issue_number: 7, action: "close_not_planned", source_type: "withdrawn", source_revision: 2, status: "processing", attempts: 1 };
}
function enableInstallation() {
  state.rotateAfterLifecycleClaim = false; state.lifecycleJobs = [lifecycleJob()];
  vi.stubEnv("GITHUB_APP_ID", "5"); vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "7"); vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey);
}

it("records the exact already confirmed lifecycle result after secret rotation without admitting new work", async () => {
  enableInstallation(); state.rotateAfterProvider = true;
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
  expect((await POST(request("github-lifecycle"))).status).toBe(500);
  const claim = calls.find(call => call.path.endsWith("claim_planning_github_lifecycle_jobs"));
  const finalized = calls.filter(call => call.path.endsWith("finalize_planning_github_lifecycle_job"));
  expect(finalized).toHaveLength(1);
  expect(finalized[0].body).toEqual({ p_job_id: "a1111111-1111-4111-8111-111111111111", p_lock_token: claim.body.p_lock_token, p_succeeded: true, p_error_message: null, p_status_reason: "delivered" });
  expect(state.providerCalls.map(call => call.method)).toEqual(["PATCH", "GET"]);
  expect(calls.filter(call => call.path.endsWith("claim_planning_github_projection_requests"))).toHaveLength(0);
});

it("does not start a provider effect after the original known lifecycle lease expires during token acquisition", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  enableInstallation(); state.expireDuringInstallation = true;
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
  await POST(request("github-lifecycle"));
  expect(state.providerCalls).toEqual([]);
});


it("does not apply provider changes after a claimed lifecycle job is reassigned while its token is awaited", async () => {
  enableInstallation(); state.reclaimDuringInstallation = true;
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
  await POST(request("github-lifecycle"));
  expect(state.providerCalls).toEqual([]);
});


it("records the exact admitted projection outcome even when its domain check observes a secret rotation", async () => {
  state.rotateAfterLifecycleClaim = false; state.rotateDuringTaskRead = true;
  state.projectionJobs = [{ id: "b1111111-1111-4111-8111-111111111111", planning_operation_id: "operation-1", task_id: "projection-task", actor_profile_id: "actor-1", create_if_missing: false, status: "processing" }];
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
  expect((await POST(request("github-lifecycle"))).status).toBe(500);
  const claim = calls.find(call => call.path.endsWith("claim_planning_github_projection_requests"));
  const finalize = calls.find(call => call.path.endsWith("finalize_planning_github_projection_request"));
  expect(finalize.body).toMatchObject({ p_request_id: "b1111111-1111-4111-8111-111111111111", p_lock_token: claim.body.p_lock_token, p_succeeded: true, p_result: { status: "notEligible", code: "github_sync_inactive", retryable: false }, p_error_message: null });
  expect(state.providerCalls).toEqual([]);
});


it("does not replay an uncertain provider mutation and reconciles the later independently claimed retry", async () => {
  enableInstallation(); state.lostPatchOnce = true;
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
  const first = await POST(request("github-lifecycle"));
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ claimed: 1, completed: 0, retryScheduled: 1, failed: 0 });
  expect(state.providerCalls.map(call => call.method)).toEqual(["PATCH"]);
  expect(state.closeEffects).toBe(1);
  const second = await POST(request("github-lifecycle"));
  expect(second.status).toBe(200);
  expect(await second.json()).toMatchObject({ claimed: 1, completed: 1, retryScheduled: 0, failed: 0 });
  expect(state.closeEffects).toBe(1);
  expect(state.providerCalls.map(call => call.method)).toEqual(["PATCH", "PATCH", "GET"]);
  expect(await (await POST(request("github-lifecycle"))).json()).toMatchObject({ claimed: 0, completed: 0 });
  expect(state.providerCalls).toHaveLength(3);
});

it("never sends the old database credential for confirmed accounting after database configuration replacement", async () => {
  enableInstallation(); state.databaseChangeAfterProvider = true;
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
  expect((await POST(request("github-lifecycle"))).status).toBe(500);
  expect(state.providerCalls.map(call => call.method)).toEqual(["PATCH", "GET"]);
  expect(calls.filter(call => call.path.endsWith("finalize_planning_github_lifecycle_job"))).toHaveLength(0);
});


it("continues the current owned job when an unrelated batch claim is lost while token issuance is held", async () => {
  enableInstallation();
  state.lifecycleJobs.push({ ...lifecycleJob(), id: "a2222222-2222-4222-8222-222222222222", root_id: "task-2", task_id: "task-2", github_issue_number: 8 });
  let releaseToken, tokenReady;
  state.tokenGate = new Promise(resolve => { releaseToken = resolve; });
  const ready = new Promise(resolve => { tokenReady = resolve; }); state.tokenReady = tokenReady;
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
  const pending = POST(request("github-lifecycle"));
  let deadline;
  try {
    await Promise.race([ready, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Synthetic token checkpoint was not reached.")), 1500); })]);
    state.foreignIds = new Set(["a2222222-2222-4222-8222-222222222222"]);
    releaseToken();
    await pending;
    expect(state.providerCalls).toEqual([{ method: "PATCH", path: "/repos/findmydoc-platform/management/issues/7" }, { method: "GET", path: "/repos/findmydoc-platform/management/issues/7/comments" }]);
  } finally { clearTimeout(deadline); releaseToken(); await pending.catch(() => {}); }
});


it("releases only the confirmed projection task lock after maintenance admission changes", async () => {
  enableInstallation();
  state.lifecycleJobs = [];
  state.fullProjection = true;
  state.rotateAfterProjectionBegin = true;
  state.projectionJobs = [{ id: "b1111111-1111-4111-8111-111111111111", task_id: "projection-task", status: "processing", actor_profile_id: "actor-1", create_if_missing: false }];
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
  await POST(request("github-lifecycle"));
  expect(calls.filter(call => call.path.endsWith("begin_github_issue_sync_transaction_v2"))).toHaveLength(1);
  expect(calls.filter(call => call.path.endsWith("release_github_issue_sync_lock")).map(call => call.body)).toEqual([{ p_resource_key: "github:findmydoc-platform/management#7", p_lock_token: "confirmed-task-lock" }]);
  expect(state.providerCalls).toEqual([]);
});


it("records the exact begun projection revision after a confirmed provider result and late maintenance replacement", async () => {
  enableInstallation(); state.lifecycleJobs = []; state.fullProjection = true; state.rotateAfterProjectionProvider = true;
  state.projectionJobs = [{ id: "b1111111-1111-4111-8111-111111111111", task_id: "projection-task", status: "processing", actor_profile_id: "actor-1", create_if_missing: false }];
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
  await POST(request("github-lifecycle"));
  expect(state.providerCalls.filter(call => call.method === "PATCH")).toHaveLength(1);
  expect(state.projectionProviderConfirmed).toBe(true);
  expect(calls.filter(call => call.path.endsWith("finalize_github_issue_sync_with_pull_requests_v1")).map(call => call.body)).toEqual([expect.objectContaining({ p_task_id: "projection-task", p_expected_updated_at: "confirmed-pending-revision", p_github_repo: "findmydoc-platform/management", p_github_issue_number: 7, p_github_issue_url: "https://github.com/findmydoc-platform/management/issues/7" })]);
  expect(calls.filter(call => call.path.endsWith("release_github_issue_sync_lock"))).toHaveLength(1);
});


it("does not replay an uncertain committed purge result", async () => {
  state.lostPurgeResponse = true;
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/purge/route.ts", { "server-only": {} });
  const response = await POST(request("purge"));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Planungspapierkorb konnte nicht bereinigt werden." });
  expect(state.purgeEffects).toBe(1);
  expect(calls.filter(call => call.path.endsWith("purge_expired_planning_trash_batch"))).toHaveLength(1);
});


it("rejects unavailable or malformed lifecycle queue counts without exposing storage details", async () => {
  state.rotateAfterLifecycleClaim = false;
  const { POST } = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
  for (const range of [null, "*/-1", "*/9007199254740992"]) {
    state.queueRange = range;
    const response = await POST(request("github-lifecycle"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "GitHub-Lifecycle des Planungspapierkorbs konnte nicht verarbeitet werden." });
  }
  vi.useFakeTimers();
  state.queueFailure = true;
  const unavailable = POST(request("github-lifecycle"));
  await vi.runAllTimersAsync();
  expect((await unavailable).status).toBe(500);
});

it("keeps action capabilities separate and preserves the effective server URL and secret-key aliases", async () => {
  state.rotateAfterLifecycleClaim = false;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ""); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "maintenance-request", request: request("purge") }, action: "maintenance.planning-trash.purge" };
  const permission = await authorizeCredentialAction(input);
  input.action = "maintenance.planning-trash.lifecycle";
  expect(permission.ok).toBe(true);
  await expect(permission.planningTrash.drainLifecycle()).rejects.toThrow("Maintenance action is not permitted.");
  await expect(permission.planningTrash.dispatchProjection()).rejects.toThrow("Maintenance action is not permitted.");
  await expect(permission.planningTrash.queueStatus()).rejects.toThrow("Maintenance action is not permitted.");
  expect(calls).toHaveLength(0);
  expect((await permission.planningTrash.purge()).error).toBeNull();
  expect(calls.map(call => call.path)).toEqual(["/rest/v1/rpc/purge_expired_planning_trash_batch"]);
  const lifecycle = await authorizeCredentialAction({ credential: { kind: "maintenance-request", request: request("github-lifecycle") }, action: "maintenance.planning-trash.lifecycle" });
  expect(lifecycle.ok).toBe(true);
  expect((await lifecycle.planningTrash.purge()).error.code).toBe("42501");
  expect(calls).toHaveLength(1);
});
