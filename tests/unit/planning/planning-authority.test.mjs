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

test("a founder creates a proposal as the bound actor and cannot approve it through creation", async () => {
  const protocol = administratorProtocol({ responses: {
    create_planning_task_transaction: body => {
      expect(body.p_actor_profile_id).toBe("synthetic-profile");
      expect(body.p_task_insert.created_by).toBe("synthetic-profile");
      return Response.json({ task: { ...body.p_task_insert, approval_status: "proposed" } });
    },
  } });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const { planningItemCreateCommand } = await importTestModule("src/features/planning-items/model/planning-items-create.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "planning.task.create" });
  expect(permission.ok).toBe(true);
  const writer = { kind: "delivery", params: { taskInsert: { id: "new-proposal", title: "Synthetic proposal", task_type: "deliverable", created_by: "forged-profile" }, relationType: null, relatedTaskId: null, relationNote: null, activityMessage: "Deliverable vorgeschlagen", relationActivityMessage: null, notifications: [], approveNow: false } };
  expect(await permission.planning.runCreate(writer, { command: planningItemCreateCommand([{ itemType: "deliverable", title: "Synthetic proposal", ownerId: "synthetic-profile" }], "synthetic-profile") })).toMatchObject({ ok: true, status: "committed" });
  expect(await permission.planning.runCreateApproval("deliverable", { command: { kind: "actOnItem", action: { kind: "decideApproval", itemId: "new-proposal", decision: "approve" } } })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  const { POST } = await importTestModule("src/app/api/tasks/route.ts", { "server-only": {} });
  const response = await POST(protocol.request("/api/tasks", "POST", { title: "Synthetic proposal" }));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: "Erstellungsanfrage ist ungültig. Bitte Dialog neu öffnen." });
});

test("commitment data stays with the owner unless the actor is an operational lead", async () => {
  const protocol = administratorProtocol();
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/sprint_commitments") return Response.json({ id: 1, ...(await request.json()) });
    if (url.pathname === "/rest/v1/audit_log") return new Response(null, { status: 201 });
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.sprint.commitment.write", targetId: "sprint-one" };
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  const values = { profileId: "synthetic-profile", commitmentLevel: "Standard", weeklyHours: 12, note: "Owner plan" };
  expect(await permission.planning.writeCommitment(values)).toMatchObject({ data: { sprint_id: "sprint-one", profile_id: "synthetic-profile", weekly_hours: 12 }, error: null });
  expect(await permission.planning.writeCommitment({ ...values, profileId: "foreign" })).toMatchObject({ data: null, error: { code: "42501" } });
  protocol.state.role = "deputy";
  const deputy = await authorizeCredentialAction(input);
  expect((await deputy.planning.writeCommitment({ ...values, profileId: "foreign" })).data.profile_id).toBe("foreign");
});

test("a deputy updates only the bound sprint schedule through the real route", async () => {
  const sprint = { id: "sprint-owned", project_id: "findmydoc-founder-execution", name: "Sprint 1", status: "planning", start_date: "2026-10-01", end_date: "2026-10-14", review_due_at: "2026-10-16T00:00:00Z", score_locked: false, updated_at: "2026-10-01T00:00:00Z" };
  const protocol = administratorProtocol({ role: "deputy", responses: {
    update_sprint_schedule_transaction: body => {
      expect(body.p_sprint_id).toBe("sprint-owned");
      expect(body.p_actor_profile_id).toBe("synthetic-profile");
      return Response.json({ ...sprint, ...body.p_sprint_patch });
    },
  } });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/sprints") return Response.json(sprint);
    if (url.pathname === "/rest/v1/active_tasks") return new Response(null, { headers: { "content-range": "*/0" } });
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.sprint.update", targetId: sprint.id };
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  expect(await permission.planning.commitSprintSchedule({ expectedUpdatedAt: sprint.updated_at, patch: { name: "Renamed sprint" } }, {})).toMatchObject({ data: { id: sprint.id, name: "Renamed sprint" }, error: null });
  const { PATCH } = await importTestModule("src/app/api/sprints/[id]/route.ts", { "server-only": {} });
  const response = await PATCH(protocol.request("/api/sprints/sprint-owned", "PATCH", { name: "Renamed sprint" }), { params: Promise.resolve({ id: sprint.id }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, sprint: { id: sprint.id, name: "Renamed sprint" } });
  protocol.state.role = "viewer";
  expect(await authorizeCredentialAction(input)).toMatchObject({ ok: false, status: 403 });
});

test("sprint planning keeps its operational-lead grant and binds the project and actor", async () => {
  const protocol = administratorProtocol({ role: "deputy", responses: {
    create_sprint_plan_with_review_window_transaction: body => {
      expect(body.p_project_id).toBe("findmydoc-founder-execution");
      expect(body.p_actor_profile_id).toBe("synthetic-profile");
      return Response.json([{ id: "planned-sprint", name: "Sprint 1" }]);
    },
  } });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.sprint.plan" };
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  expect(await permission.planning.commitSprintPlan({ sprints: [], meetings: [], auditData: {} }, {})).toMatchObject({ data: [{ id: "planned-sprint" }], error: null });
  protocol.state.role = "founder";
  expect(await authorizeCredentialAction(input)).toMatchObject({ ok: false, status: 403 });
});

test("only the CEO locks a sprint and the real route retains a stored replay", async () => {
  const stored = { sprint: { id: "locked-sprint", status: "closed", scoreLocked: true }, carryover: { created: 0 } };
  const protocol = administratorProtocol({ role: "ceo", responses: {
    lock_sprint_with_review_window_transaction: body => {
      expect(body.p_sprint_id).toBe("locked-sprint");
      expect(body.p_actor_profile_id).toBe("synthetic-profile");
      return Response.json(stored);
    },
  } });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/sprints") return Response.json({ id: "locked-sprint", project_id: "findmydoc-founder-execution", score_locked: true, lock_result: stored });
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.sprint.lock", targetId: "locked-sprint" };
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  const values = { expectedUpdatedAt: "2026-10-17T08:00:00Z", taskUpdates: [], acceptedBlockerTaskIds: [], carryoverInserts: [], notifications: [], scoreRows: [], strikeStateRows: [], strikeEvents: [], resultData: stored };
  expect(await permission.planning.commitSprintLock(values, {})).toMatchObject({ data: stored, error: null });
  const { POST } = await importTestModule("src/app/api/sprints/[id]/lock/route.ts", { "server-only": {} });
  const response = await POST(protocol.request("/api/sprints/locked-sprint/lock", "POST", {}), { params: Promise.resolve({ id: "locked-sprint" }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, replayed: true, sprint: stored.sprint });
  protocol.state.role = "deputy";
  expect(await authorizeCredentialAction(input)).toMatchObject({ ok: false, status: 403 });
});

test("the review window remains CEO-only even with an active administrator", async () => {
  const protocol = administratorProtocol({ role: "founder", responses: {
    update_founderops_review_window_transaction: body => {
      expect(body.p_project_id).toBe("findmydoc-founder-execution");
      expect(body.p_actor_profile_id).toBe("synthetic-profile");
      return Response.json({ project: { id: body.p_project_id, reviewObjectionWindowHours: 72 }, sprints: [] });
    },
  } });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.sprint.review-window" };
  expect(await authorizeCredentialAction(input)).toMatchObject({ ok: false, status: 403 });
  protocol.state.role = "ceo";
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  expect(await permission.planning.setReviewWindow({ expectedHours: 48, hours: 72 }, {})).toMatchObject({ data: { project: { reviewObjectionWindowHours: 72 } }, error: null });
  const { PATCH } = await importTestModule("src/app/api/sprints/review-window/route.ts", { "server-only": {} });
  const response = await PATCH(protocol.request("/api/sprints/review-window", "PATCH", { expectedReviewObjectionWindowHours: 48, reviewObjectionWindowHours: 72 }));
  expect(response.status).toBe(200);
});

test("score objections bind their owner and reserve resolution for the CEO", async () => {
  const protocol = administratorProtocol({ responses: {
    create_score_objection_transaction: body => {
      expect(body.p_sprint_id).toBe("score-sprint");
      expect(body.p_profile_id).toBe("synthetic-profile");
      return Response.json({ id: 10, profile_id: body.p_profile_id, sprint_id: body.p_sprint_id });
    },
    process_score_objection_transaction: body => {
      expect(body.p_actor_profile_id).toBe("synthetic-profile");
      return Response.json({ objection: { id: body.p_objection_id, sprint_id: body.p_sprint_id } });
    },
  } });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.sprint.objection.create", targetId: "score-sprint" };
  const owner = await authorizeCredentialAction(input);
  expect(owner.ok).toBe(true);
  expect(await owner.planning.createScoreObjection("Evidence for my score", {})).toMatchObject({ data: { profile_id: "synthetic-profile", sprint_id: "score-sprint" } });
  const processInput = { ...input, action: "planning.sprint.objection.process" };
  const reviewer = await authorizeCredentialAction(processInput);
  expect(reviewer.ok).toBe(true);
  const values = { action: "resolve", objectionId: 10, status: "accepted", resolutionComment: "Verified" };
  expect(await reviewer.planning.processScoreObjection(values, {})).toMatchObject({ data: null, error: { code: "42501" } });
  expect(await reviewer.planning.processScoreObjection({ action: "second_review", objectionId: 10, secondReviewDecision: "Independent evidence checked" }, {})).toMatchObject({ data: { objection: { id: 10 } } });
  protocol.state.role = "ceo";
  const ceo = await authorizeCredentialAction(processInput);
  expect(await ceo.planning.processScoreObjection(values, {})).toMatchObject({ data: { objection: { id: 10 } } });
});

test("bulk sprint assignment binds the selected tasks and cannot transfer to another sprint", async () => {
  const task = { id: "assigned-task", task_type: "deliverable", updated_at: "2026-10-17T08:00:00Z", approval_status: "approved", status: "Offen", owner: "synthetic-profile", parent_task_id: "approved-initiative" };
  const protocol = administratorProtocol({ role: "deputy", responses: { assign_backlog_tasks_to_sprint_transaction: [{ id: task.id, sprintId: "target-sprint", scoreRelevant: true, updatedAt: "2026-10-17T08:01:00Z" }] } });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/tasks") return Response.json(url.searchParams.get("id")?.includes("approved-initiative") ? [{ id: "approved-initiative", task_type: "initiative", updated_at: task.updated_at, approval_status: "approved" }] : [task]);
    if (url.pathname === "/rest/v1/sprints") return Response.json([{ id: "target-sprint", score_locked: false }]);
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.sprint.assign", targetId: "target-sprint", targetIds: [task.id] };
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  const action = { kind: "assignSprint", sprintId: "target-sprint", items: [{ itemId: task.id, expectedRevision: task.updated_at }] };
  expect(await permission.planning.runSprintAssignment({ command: { kind: "actOnItem", action } })).toMatchObject({ ok: true, status: "committed" });
  input.targetIds.push("foreign-task");
  expect(await permission.planning.runSprintAssignment({ command: { kind: "actOnItem", action: { ...action, items: [{ itemId: "foreign-task", expectedRevision: task.updated_at }] } } })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  expect(await permission.planning.runSprintAssignment({ command: { kind: "actOnItem", action: { ...action, sprintId: "foreign-sprint" } } })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  protocol.state.role = "founder";
  expect(await authorizeCredentialAction(input)).toMatchObject({ ok: false, status: 403 });
});

test("backlog ordering keeps its operational decision and its selected neighbor", async () => {
  const revision = "2026-10-17T08:00:00Z";
  const source = { id: "move-source", project_id: "findmydoc-founder-execution", task_type: "deliverable", status: "Offen", sort_order: 20, updated_at: revision };
  const target = { ...source, id: "move-target", sort_order: 10 };
  const protocol = administratorProtocol({ role: "deputy", responses: { move_backlog_task_transaction: [{ id: source.id, sortOrder: 10, updatedAt: revision }, { id: target.id, sortOrder: 20, updatedAt: revision }] } });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/tasks" || url.pathname === "/rest/v1/active_tasks") return Response.json([target, source]);
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.backlog.move", targetId: source.id, targetIds: [target.id] };
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  const call = { command: { kind: "actOnItem", action: { kind: "moveBacklog", itemId: source.id, expectedRevision: revision, before: { itemId: target.id, expectedRevision: revision } } } };
  expect(await permission.planning.runBacklogMove(call)).toMatchObject({ ok: true, status: "committed" });
  expect(await permission.planning.runBacklogMove({ command: { ...call.command, action: { ...call.command.action, before: { itemId: "foreign-neighbor", expectedRevision: revision } } } })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  protocol.state.role = "founder";
  const founder = await authorizeCredentialAction(input);
  expect(founder.ok).toBe(true);
  expect(await founder.planning.runBacklogMove(call)).toMatchObject({ ok: false, error: { code: "forbidden" } });
});

test("approval uses the observed item kind and the existing operational decision", async () => {
  const task = { id: "approval-target", task_type: "initiative", title: "Proposal", approval_status: "proposed", approval_revision: 1, updated_at: "2026-10-17T08:00:00Z" };
  const protocol = administratorProtocol({ role: "deputy", responses: {
    prepare_planning_approval_command: { task, actorRole: "deputy", profiles: [] },
    mutate_planning_approval_command_transaction: { task: { ...task, approval_status: "rejected", approval_revision: 2 } },
  } });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/tasks") return Response.json({ task_type: "initiative" });
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.approval.decide", targetId: task.id };
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  expect(await permission.planning.readItemKind()).toMatchObject({ data: { task_type: "initiative" }, error: null });
  const call = { command: { kind: "actOnItem", action: { kind: "decideApproval", itemId: task.id, expectedApprovalRevision: 1, decision: "rejected", note: "Needs revision" } } };
  expect(await permission.planning.runApproval("deliverable", call)).toMatchObject({ ok: false, error: { code: "forbidden" } });
  expect(await permission.planning.runApproval("initiative", call)).toMatchObject({ ok: true, status: "committed" });
  const { POST } = await importTestModule("src/app/api/tasks/[id]/approval/route.ts", { "server-only": {} });
  const response = await POST(protocol.request("/api/tasks/approval-target/approval", "POST", { expectedRevision: 1, action: "reject", note: "Needs revision" }), { params: Promise.resolve({ id: task.id }) });
  expect(response.status).toBe(200);
});

test("trash withdrawal keeps proposer ownership and binds the following lifecycle to its commit", async () => {
  const task = { id: "withdraw-target", task_type: "deliverable", approval_status: "proposed", approval_revision: 1, proposed_by: "synthetic-profile", trash_revision: 0 };
  const transaction = { rootType: "deliverable", rootId: task.id, affectedTaskIds: [task.id], trashRevision: 1, item: task, eventIds: [] };
  const protocol = administratorProtocol({ responses: {
    prepare_planning_trash_command: { task, actorRole: "founder", affectedTaskIds: [task.id] },
    mutate_planning_trash_command_transaction: transaction,
    claim_planning_github_lifecycle_jobs_for_root: [],
  } });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/tasks") return Response.json({ task_type: "deliverable" });
    if (url.pathname === "/rest/v1/planning_github_lifecycle_outbox") return Response.json([]);
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "planning.trash.withdraw", targetId: task.id };
  const permission = await authorizeCredentialAction(input);
  expect(permission.ok).toBe(true);
  await permission.planning.readItemKind();
  const call = { command: { kind: "actOnItem", action: { kind: "withdraw", itemId: task.id, expectedApprovalRevision: 1, reason: "Revise proposal" } } };
  const result = await permission.planning.runTrash("deliverable", call);
  expect(result).toMatchObject({ ok: true, status: "committed" });
  result.changes.find(change => change.field === "planningTrash").after.rootId = "foreign-root";
  await permission.planning.trashLifecycle();
  expect(protocol.calls.find(call => call.name === "claim_planning_github_lifecycle_jobs_for_root").body.p_root_id).toBe(task.id);
  protocol.state.responses.prepare_planning_trash_command = { task: { ...task, proposed_by: "foreign-proposer" }, actorRole: "founder", affectedTaskIds: [task.id] };
  expect(await permission.planning.runTrash("deliverable", call)).toMatchObject({ ok: false, error: { code: "forbidden" } });
  expect(await authorizeCredentialAction({ ...input, action: "planning.trash.restore" })).toMatchObject({ ok: false, status: 403 });
});


test("legacy Focus capabilities bind task ownership, entry and operation", async () => {
  const protocol = administratorProtocol({ role: "founder" });
  const authFetch = globalThis.fetch;
  const writes = [];
  let owner = "synthetic-profile";
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/active_tasks") return Response.json({ id: "focus-task", assignee: owner });
    if (url.pathname === "/rest/v1/task_focus_items") {
      if (request.method === "POST") { const body = await request.json(); writes.push(body); return Response.json({ ...body, id: 1 }); }
      return Response.json([]);
    }
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "planning.focus.write", targetId: "focus-task" });
  expect(permission.ok).toBe(true);
  const values = { profileId: "foreign", focusDate: "2026-10-17", position: 1, nextStep: "Evidence", status: "planned" };
  expect(await permission.planning.writeFocus(values)).toMatchObject({ error: { code: "42501" } });
  expect(await permission.planning.writeFocus({ ...values, profileId: "synthetic-profile" })).toMatchObject({ error: null, data: { task_id: "focus-task" } });
  expect(writes[0].profile_id).toBe("synthetic-profile");
  expect(await permission.planning.deleteFocus()).toMatchObject({ error: { code: "42501" } });
  owner = "foreign";
  expect(await permission.planning.writeFocus({ ...values, profileId: "synthetic-profile" })).toMatchObject({ error: { code: "42501" } });
  protocol.state.role = "viewer";
  expect(await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "planning.focus.write", targetId: "focus-task" })).toMatchObject({ ok: false, status: 403 });
});


test("Weekly self reports bind owner and meeting while lead reviews preserve scoring", async () => {
  const protocol = administratorProtocol({ role: "founder" });
  const authFetch = globalThis.fetch;
  const writes = [];
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/meetings") return Response.json({ id: 7, title: "Weekly" });
    if (url.pathname === "/rest/v1/meeting_attendance") { const body = await request.json(); writes.push(body); return Response.json({ id: 1, ...body }); }
    if (url.pathname === "/rest/v1/profiles") return Response.json([{ id: "lead" }]);
    if (["/rest/v1/notification_events", "/rest/v1/audit_log"].includes(url.pathname)) return new Response(null, { status: 201 });
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const grant = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "planning.attendance.write", targetId: "7" });
  expect(grant.ok).toBe(true);
  const values = { profileId: "synthetic-profile", status: "excused", absenceReason: "Customer appointment", reasonAccepted: false, writtenUpdate: "Evidence", points: 0 };
  expect(await grant.planning.writeAttendance({ ...values, profileId: "foreign" })).toMatchObject({ error: { code: "42501" } });
  expect(await grant.planning.writeAttendance({ ...values, points: 2 })).toMatchObject({ error: { code: "42501" } });
  expect(await grant.planning.writeAttendance(values)).toMatchObject({ error: null, data: { meeting_id: 7, profile_id: "synthetic-profile", points: 0 } });
  expect(await grant.planning.notifyAttendance([{ actor_profile_id: "synthetic-profile", entity_type: "meeting", entity_id: "7", type: "meeting.attendance_updated", recipient_profile_id: "foreign" }])).toMatchObject({ error: { code: "42501" } });
  const { POST } = await importTestModule("src/app/api/meetings/[id]/attendance/route.ts", { "server-only": {} });
  expect((await POST(protocol.request("/api/meetings/7/attendance", "POST", { status: "present" }), { params: Promise.resolve({ id: "7" }) })).status).toBe(403);
  protocol.state.role = "deputy";
  const response = await POST(protocol.request("/api/meetings/7/attendance", "POST", { profileId: "foreign", status: "present" }), { params: Promise.resolve({ id: "7" }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ attendance: { meetingId: 7, profileId: "foreign", points: 2 } });
  expect(writes).toHaveLength(2);
});


test("task comments bind their author, item and committed delivery IDs", async () => {
  const protocol = administratorProtocol({ role: "founder", responses: { create_task_comment_with_notifications: { comment: { id: 8, task_id: "comment-task", profile_id: "synthetic-profile", comment: "Evidence is ready" } } } });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/tasks") return Response.json({ id: "comment-task", task_type: "epic", title: "Comment task" });
    if (url.pathname === "/rest/v1/profiles") return Response.json([{ id: "synthetic-profile", name: "Founder", platform_role: "founder" }]);
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const grant = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "planning.comment.create", targetId: "comment-task" });
  expect(grant.ok).toBe(true);
  expect(await grant.planning.writeComment({ comment: "Evidence is ready", mentions: [], recipients: [] })).toMatchObject({ data: { comment: { id: 8 } } });
  expect(protocol.calls.find(call => call.name === "create_task_comment_with_notifications").body).toMatchObject({ p_task_id: "comment-task", p_profile_id: "synthetic-profile", p_deliver_to_github: false });
  expect(await grant.planning.writeComment({ comment: "Evidence", mentions: [], recipients: ["foreign"] })).toMatchObject({ error: { code: "42501" } });
  expect(await grant.planning.readCommentDelivery(999)).toMatchObject({ error: { code: "42501" } });
  expect(await grant.planning.writeBlocker({ reason: "Foreign operation", impact: "", needsHelpFrom: "", notifications: [], mentions: [] }, {})).toMatchObject({ error: { code: "42501" } });
  protocol.state.role = "viewer";
  expect(await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "planning.comment.create", targetId: "comment-task" })).toMatchObject({ ok: false, status: 403 });
});


test("blocker HTTP workflow retains owner and review-state restrictions", async () => {
  const task = { id: "blocked-task", title: "Blocked", assignee: "synthetic-profile", owner: "synthetic-profile", status: "In Arbeit", task_type: "deliverable", review_status: "not_requested", score_final: false };
  const protocol = administratorProtocol({ role: "founder", responses: { report_task_blocker_transaction_v2: { blocker: { id: 2, task_id: task.id, profile_id: "synthetic-profile", reason: "Missing dependency", status: "open" } } } });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/tasks") return Response.json(task);
    if (url.pathname === "/rest/v1/profiles") return Response.json([{ id: "synthetic-profile", name: "Founder", platform_role: "founder" }]);
    return authFetch(request);
  });
  const { POST } = await importTestModule("src/app/api/tasks/[id]/blockers/route.ts", { "server-only": {} });
  const run = () => POST(protocol.request("/api/tasks/blocked-task/blockers", "POST", { reason: "Missing dependency" }), { params: Promise.resolve({ id: task.id }) });
  expect((await run()).status).toBe(200);
  expect(protocol.calls.find(call => call.name === "report_task_blocker_transaction_v2").body).toMatchObject({ p_task_id: task.id, p_actor_profile_id: "synthetic-profile" });
  task.assignee = "foreign"; task.owner = "foreign";
  expect((await run()).status).toBe(403);
  task.assignee = "synthetic-profile"; task.review_status = "requested"; task.status = "Review";
  expect((await run()).status).toBe(403);
  expect(protocol.calls.filter(call => call.name === "report_task_blocker_transaction_v2")).toHaveLength(1);
});


test("attachment bookkeeping requires an authorized bound task before provider effects", async () => {
  const protocol = administratorProtocol({ role: "founder" });
  const authFetch = globalThis.fetch;
  const audits = [];
  let owner = "synthetic-profile";
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/tasks") return request.method === "GET" ? Response.json({ id: "attachment-task", task_type: "deliverable", status: "In Arbeit", assignee: owner, review_status: "not_requested" }) : new Response(null, { status: 204 });
    if (url.pathname === "/rest/v1/audit_log") { const body = await request.json(); audits.push(body); return Response.json({ id: 9, ...body }); }
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const acquire = () => authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "planning.attachment.write", targetId: "attachment-task" });
  const grant = await acquire();
  expect(grant.ok).toBe(true);
  const values = { filename: "Evidence.pdf", contentType: "application/pdf", size: 42, url: "https://example.test/evidence" };
  expect(await grant.planning.recordAttachment(values, {})).toMatchObject({ error: { code: "42501" } });
  expect(await grant.planning.readCollaborationTask()).toMatchObject({ data: { id: "attachment-task" } });
  expect(await grant.planning.recordAttachment(values, {})).toMatchObject({ data: { entity_id: "attachment-task", actor_profile_id: "synthetic-profile" } });
  owner = "foreign";
  const foreign = await acquire();
  await foreign.planning.readCollaborationTask();
  expect(await foreign.planning.recordAttachment(values, {})).toMatchObject({ error: { code: "42501" } });
  expect(audits).toHaveLength(1);
});


test("GitHub comment import keeps viewer read access and binds the imported task", async () => {
  const protocol = administratorProtocol({ role: "viewer", responses: { import_github_task_comments_with_mentions: { imported: 1 } } });
  const authFetch = globalThis.fetch;
  const writes = [];
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/tasks") { if (request.method !== "GET") writes.push(await request.json()); return Response.json({ id: "import-task", task_type: "deliverable", assignee: "other", status: "In Arbeit" }); }
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "planning.github-comments.import", targetId: "import-task" });
  expect(permission.ok).toBe(true);
  expect(await permission.planning.importExternalComments([{ externalId: "7", body: "Evidence" }])).toMatchObject({ data: { imported: 1 } });
  expect(protocol.calls.find(call => call.name === "import_github_task_comments_with_mentions").body.p_task_id).toBe("import-task");
  expect(await permission.planning.updateImportedEvidence("https://example.test/evidence")).toMatchObject({ error: { code: "42501" } });
  expect(writes).toHaveLength(0);
  expect(await permission.planning.readProjectionKind()).toMatchObject({ error: { code: "42501" } });
  protocol.state.profile = false;
  expect(await permission.planning.importExternalComments([])).toMatchObject({ error: { code: "42501" } });
});
