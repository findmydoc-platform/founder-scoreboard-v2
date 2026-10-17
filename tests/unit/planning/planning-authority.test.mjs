import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

test("a mapped viewer reads the planning revision through an action-bound capability", async () => {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/active_tasks") {
      expect(url.searchParams.get("project_id")).toBe("eq.findmydoc-founder-execution");
      return Response.json([{ updated_at: "2026-10-17T08:00:00Z" }], { headers: { "content-range": "0-0/7" } });
    }
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const result = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "planning.revision.read" });
  if (!result.ok) throw new Error(`${result.status}: ${result.error}`);
  const revision = await result.planning.readRevision();
  expect(revision.error).toBeNull();
  expect(revision.count).toBe(7);
  expect(revision.data).toEqual([{ updated_at: "2026-10-17T08:00:00Z" }]);
  expect(result).not.toHaveProperty("supabase");
  expect(result.planning).not.toHaveProperty("rpc");
});

test("the planning board preserves its project and current actor through the public seam", async () => {
  const protocol = administratorProtocol({ role: "founder" });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) {
      if (url.pathname === "/rest/v1/projects") return Response.json({ id: "findmydoc-founder-execution", name: "Planning", range_label: "", review_objection_window_hours: 48 });
      return Response.json([]);
    }
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "planning.board.read" });
  expect(permission.ok).toBe(true);
  const result = await permission.planning.loadBoard();
  expect(result).toMatchObject({ status: "ready", model: { project: { name: "Planning" }, items: [], relationships: [] } });
});

test("a read grant cannot change its bound operation after authorization", async () => {
  const protocol = administratorProtocol({ role: "viewer" });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) return url.pathname === "/rest/v1/projects"
      ? Response.json({ id: "findmydoc-founder-execution", name: "Planning" }) : Response.json([]);
    return authFetch(request);
  });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.revision.read" };
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  input.action = "planning.board.read";
  expect(await permission.planning.loadBoard()).toEqual({ status: "forbidden" });
});

test.each(["planning.review.request", "planning.task.update"])("%s requests review only for the bound item and existing ownership", async (action) => {
  const task = { id: "task-one", task_type: "deliverable", title: "Review task", updated_at: "2026-10-17T08:00:00Z", status: "In Arbeit", approval_status: "approved", assignee: "synthetic-profile", owner: "synthetic-profile", review_status: "not_requested", review_owner_profile_id: "reviewer", score_final: false };
  const protocol = administratorProtocol({ snapshot: { eligible: false, active: false }, responses: {
    prepare_planning_review_command: { task, actorName: "Synthetic Founder", defaultReviewer: { id: "reviewer", contributor: true } },
    has_valid_planning_review_evidence: true,
    mutate_planning_review_command_transaction_v3: { task: { ...task, status: "Review", review_status: "requested" }, activities: [] },
  } });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action, targetId: "task-one" });
  expect(permission.ok).toBe(true);
  const call = { command: { kind: "actOnItem", action: { kind: "requestReview", itemId: "task-one", expectedRevision: task.updated_at } } };
  expect(await permission.planning.runReview(call)).toMatchObject({ ok: true, status: "committed" });
  expect(protocol.calls.find(call => call.name === "mutate_planning_review_command_transaction_v3").body.p_actor_profile_id).toBe("synthetic-profile");
  const decide = { command: { kind: "actOnItem", action: { kind: "decideReview", itemId: "task-one" } } };
  expect(await permission.planning.runReview(decide)).toMatchObject({ ok: false, error: { code: "forbidden" } });
  expect(await permission.planning.runReview({ command: { ...call.command, action: { ...call.command.action, itemId: "foreign" } } })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  protocol.state.responses.prepare_planning_review_command = { task: { ...task, assignee: "foreign-owner", owner: "foreign-owner" }, actorName: "Synthetic Founder", defaultReviewer: { id: "reviewer", contributor: true } };
  expect(await permission.planning.runReview(call)).toMatchObject({ ok: false, error: { code: "forbidden" } });
});

test.each([
  ["decide", "decideReview", { status: "Review", review_status: "requested" }, { decision: "accepted", note: "Reviewed evidence", checklist: { acceptanceCriteriaMet: true, evidenceProvided: true, communicationClear: true, blockerHandled: true } }],
  ["withdraw", "withdrawReview", { status: "Review", review_status: "requested" }, { reason: "Evidence needs revision" }],
  ["reopen", "reopenReview", { status: "Erledigt", review_status: "accepted", score_final: true }, {}],
])("the %s review capability retains its specific workflow and rejects a viewer", async (operation, kind, state, fields) => {
  const task = { id: "review-task", task_type: "deliverable", title: "Review task", updated_at: "2026-10-17T08:00:00Z", approval_status: "approved", assignee: "synthetic-profile", owner: "synthetic-profile", review_owner_profile_id: "synthetic-profile", score_final: false, ...state };
  const protocol = administratorProtocol({ responses: {
    prepare_planning_review_command: { task, actorName: "Synthetic Founder", reviewer: { id: "synthetic-profile", contributor: true }, defaultReviewer: { id: "synthetic-profile", contributor: true } },
    has_valid_planning_review_evidence: true,
    mutate_planning_review_command_transaction_v3: { task, activities: [], review: operation === "decide" ? { id: 1, task_id: task.id, sprint_id: "", reviewer_profile_id: "synthetic-profile", decision: "accepted", points: 12, comment: "Reviewed evidence", checklist: fields.checklist, created_at: "2026-10-17T08:01:00Z" } : null },
  } });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: `planning.review.${operation}`, targetId: task.id };
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  expect(await permission.planning.runReview({ command: { kind: "actOnItem", action: { kind, itemId: task.id, expectedRevision: task.updated_at, ...fields } } })).toMatchObject({ ok: true, status: "committed" });
  expect(protocol.calls.find(call => call.name === "mutate_planning_review_command_transaction_v3").body.p_action).toBe(operation);
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) return Response.json([]);
    return authFetch(request);
  });
  const routePath = operation === "decide" ? "src/app/api/tasks/[id]/review/route.ts" : `src/app/api/tasks/[id]/review/${operation}/route.ts`;
  const { POST } = await importTestModule(routePath, { "server-only": {} });
  const payload = operation === "decide" ? { decision: "accepted", comment: "Reviewed evidence", checklist: fields.checklist }
    : { expectedUpdatedAt: task.updated_at, ...(operation === "withdraw" ? { reason: fields.reason } : {}) };
  const response = await POST(protocol.request("/api/tasks/review-task/review", "POST", payload), { params: Promise.resolve({ id: task.id }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, task: { id: task.id } });
  protocol.state.role = "viewer";
  expect(await authorizeCredentialAction(input)).toMatchObject({ ok: false, status: 403 });
});

test.each([
  ["planning.backlog.read", "loadBacklog", "ready"],
  ["planning.sprint.read", "loadSprint", "ready"],
  ["planning.task.read", "loadDetail", "notFound"],
])("%s retains its fixed read and denies unmapped sessions", async (action, method, status) => {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) {
      if (url.pathname === "/rest/v1/projects") return Response.json({ id: "findmydoc-founder-execution", name: "Planning", review_objection_window_hours: 48 });
      return Response.json(request.headers.get("accept")?.includes("object") ? null : []);
    }
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action, targetId: "missing-task" };
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  expect(await permission.planning[method]()).toMatchObject({ status });
  protocol.state.profile = false;
  expect(await authorizeCredentialAction(input)).toMatchObject({ ok: false, status: 403 });
  expect(await permission.planning[method]()).toMatchObject({ status: "forbidden" });
});

test("temporary task correction expires at its actual deadline without borrowing a planning role", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-10-17T08:00:00Z"));
    const protocol = administratorProtocol({ role: "viewer", snapshot: { eligible: true, active: true, expiresAt: "2026-10-17T08:01:00Z" } });
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.task.update", targetId: "own-task" };
    const permission = await authorizeCredentialAction(input);
    expect(permission.ok).toBe(true);
    expect(permission.authority.capabilities.operationalCorrection).toBe(true);
    vi.setSystemTime(new Date("2026-10-17T08:01:00Z"));
    expect(await permission.planning.revise({ expectedUpdatedAt: "2026-10-17T07:00:00Z", title: "Changed title" })).toMatchObject({ ok: false, error: { kind: "forbidden", code: "administrator_access_expired" } });
    expect(await authorizeCredentialAction(input)).toMatchObject({ ok: false, status: 403, code: "administrator_access_expired" });
  } finally { vi.useRealTimers(); }
});

test("an owner adds only the bound dependency and keeps foreign-owner restrictions", async () => {
  const source = { id: "dependency-source", task_type: "deliverable", updated_at: "2026-10-17T08:00:00Z", owner: "synthetic-profile", assignee: "synthetic-profile", status: "Offen" };
  const related = { id: "dependency-target", task_type: "deliverable", status: "Offen" };
  const protocol = administratorProtocol({ snapshot: { eligible: false, active: false }, responses: {
    prepare_planning_relationship_command: { source, related, actorName: "Synthetic Founder" },
    mutate_planning_relationship_transaction_v2: { relation: { id: 1, task_id: source.id, related_task_id: related.id, relation_type: "blocked_by", note: "Dependency", created_by: "synthetic-profile", created_at: "2026-10-17T08:01:00Z" } },
  } });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.relationship.add", targetId: source.id };
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  const call = { command: { kind: "actOnItem", action: { kind: "addRelationship", itemId: source.id, relatedItemId: related.id, relation: "blocked_by", note: "Dependency", expectedRevision: source.updated_at } } };
  expect(await permission.planning.runRelationship(call, [])).toMatchObject({ ok: true, status: "committed" });
  expect(await permission.planning.runRelationship({ command: { kind: "actOnItem", action: { kind: "removeRelationship", itemId: source.id, relationshipId: 1 } } }, [])).toMatchObject({ ok: false, error: { code: "forbidden" } });
  protocol.state.responses.prepare_planning_relationship_command = { source: { ...source, owner: "foreign-owner", assignee: "foreign-owner" }, related, actorName: "Synthetic Founder" };
  expect(await permission.planning.runRelationship(call, [])).toMatchObject({ ok: false, error: { code: "forbidden" } });
});

test("empty Epic deletion remains operational-lead-only and bound to its issued target", async () => {
  const protocol = administratorProtocol({ role: "founder" });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.task.delete", targetId: "empty-epic" };
  expect(await authorizeCredentialAction(input)).toMatchObject({ ok: false, status: 403 });
  protocol.state.role = "deputy";
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  expect(await permission.planning.runDelete({ command: { kind: "actOnItem", action: { kind: "deleteEmptyEpic", itemId: "foreign-epic", expectedRevision: "2026-10-17T08:00:00Z" } } })).toMatchObject({ ok: false, error: { code: "forbidden" } });
});
