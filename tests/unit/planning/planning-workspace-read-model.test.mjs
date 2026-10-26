import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

function createSupabaseFixture(failedTable = "") {
  const calls = [];
  const data = {
    projects: { id: "findmydoc-founder-execution", name: "findmydoc Planning", range_label: "", review_objection_window_hours: 48 },
    profiles: [{ id: "person", name: "Person", github_login: "person-login" }],
    active_tasks: [
      { id: "epic", task_type: "epic", parent_task_id: null, approval_status: "not_required", updated_at: "2026-08-10T00:00:00.000Z" },
      { id: "initiative", task_type: "initiative", parent_task_id: "epic", approval_status: "approved", updated_at: "2026-08-11T00:00:00.000Z" },
      { id: "deliverable", task_type: "deliverable", parent_task_id: "initiative", approval_status: "approved", updated_at: "2026-08-12T00:00:00.000Z" },
    ],
    planning_item_strategy: [],
    planning_item_raci_assignments: [],
    task_links: [],
    sprints: [{ id: "sprint" }],
    task_relationship_edges: [
      { id: 1, task_id: "deliverable", related_task_id: "initiative", relation_type: "relates_to" },
      { id: 2, task_id: "deliverable", related_task_id: "inactive", relation_type: "relates_to" },
    ],
    profile_ui_preferences: [{ profile_id: "person" }],
  };
  return {
    calls,
    data,
    from(table) {
      const call = { table, eq: [], orders: [], limit: null, select: "" };
      calls.push(call);
      const query = {
        select(columns) { call.select = columns; return query; },
        eq(field, value) { call.eq.push([field, value]); return query; },
        single() { return query; },
        order(field, options) { call.orders.push([field, options]); return query; },
        limit(value) { call.limit = value; return query; },
        then(resolve, reject) {
          const result = table === failedTable
            ? { data: null, error: { message: "fixture failure" } }
            : { data: data[table] ?? [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const moduleStubs = {
  "server-only": {},
  "@/lib/planning-row-mappers": { mapTaskRelation: (row) => ({ id: row.id, taskId: row.task_id, relatedTaskId: row.related_task_id, relationType: row.relation_type }) },
  "@/lib/planning-profile-mappers": {
    profileNameById: (profiles, id) => profiles.find((profile) => profile.id === id)?.name || id || "",
    mapProfile: (row) => ({ id: row.id, name: row.name, githubLogin: row.github_login || "" }),
    mapProfileUiPreference: (row) => ({ profileId: row.profile_id }),
  },
  "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
  "@/lib/planning-sprint-mappers": { mapSprint: (row) => row },
  "@/lib/sprint-review-window": { DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS: 48 },
  "@/features/planning-items/server/workspace-profile-avatars": {
    withWorkspaceProfileAvatars: async (profiles) => profiles.map((profile) => ({ ...profile, avatarUrl: "https://lh3.googleusercontent.com/a/profile" })),
  },
};

const { loadPlanningWorkspaceModel, mapPlanningSummaryRows } = await importTestModule(
  "src/features/planning-items/server/planning-workspace-read-source.ts",
  moduleStubs,
);

test("planning workspace reader fails closed and distinguishes dependency failure", async () => {
  const denied = createSupabaseFixture();
  assert.deepEqual(await loadPlanningWorkspaceModel(denied, { authorized: false, actorProfileId: null }), { status: "forbidden" });
  assert.equal(denied.calls.length, 0);
  const unavailable = createSupabaseFixture("task_relationship_edges");
  assert.deepEqual(await loadPlanningWorkspaceModel(unavailable, { authorized: true, actorProfileId: "person" }), { status: "unavailable" });
});

test("planning workspace reader loads only the focused canonical model", async () => {
  const supabase = createSupabaseFixture();
  const result = await loadPlanningWorkspaceModel(supabase, { authorized: true, actorProfileId: "person" });
  assert.equal(result.status, "ready");
  assert.equal(result.model.revision, "2026-08-12T00:00:00.000Z");
  assert.deepEqual(result.model.items.map(({ id }) => id), ["epic", "initiative", "deliverable"]);
  assert.equal(result.model.items.find(({ id }) => id === "deliverable").parentApprovalStatus, "approved");
  assert.deepEqual(result.model.relationships.map(({ id }) => id), [1]);
  assert.equal(result.model.people[0].githubLogin, "person-login");
  assert.equal(result.model.people[0].avatarUrl, "https://lh3.googleusercontent.com/a/profile");
  assert.deepEqual(Object.keys(result.model).sort(), ["items", "people", "preferences", "project", "relationships", "revision", "sprints"]);
  assert.deepEqual(supabase.calls.map(({ table }) => table), [
    "projects",
    "profiles",
    "active_tasks",
    "planning_item_strategy",
    "planning_item_raci_assignments",
    "task_links",
    "sprints",
    "task_relationship_edges",
    "profile_ui_preferences",
  ]);
  assert.equal(supabase.calls.find(({ table }) => table === "task_relationship_edges").limit, 500);
  const select = supabase.calls.find(({ table }) => table === "active_tasks").select;
  assert.doesNotMatch(select, /intended_outcome|scope_constraints|evidence_required|task_notes/);
  assert.match(select, /description/);
  assert.match(select, /acceptance_criteria/);
  assert.match(select, /definition_of_done/);
  for (const column of ["sprint_id", "target_date", "fixed_date", "parent_task_id", "assignee", "status", "priority", "workstream", "task_dependencies(note)"]) {
    assert.ok(select.includes(column), `${column} must remain in the summary query`);
  }
  assert.equal(result.model.items[0].detailAvailability, "summary");
  assert.match(supabase.calls.find(({ table }) => table === "profiles").select, /(?:^|,)github_login(?:,|$)/);
});

test("planning startup summaries omit detail briefs while preserving search, quality and sub-issue context", () => {
  const result = mapPlanningSummaryRows([{ id: "deliverable", task_type: "deliverable", description: "search context", problem_statement: "private brief", intended_outcome: "outcome", scope_constraints: "scope", evidence_required: "proof", acceptance_criteria: "criteria", definition_of_done: "search quality", sprint_id: "sprint-2", target_date: "2026-10-10", fixed_date: "2026-10-11", parent_task_id: "initiative", assignee: "owner", status: "In Arbeit", priority: "P1", workstream: "Engineering", task_dependencies: [{ note: "waiting" }] }], [], [], [], []);
  assert.equal(result[0].detailAvailability, "summary");
  assert.equal(result[0].problemStatement, "");
  assert.equal(result[0].intendedOutcome, "");
  assert.equal(result[0].scopeConstraints, "");
  assert.equal(result[0].evidenceRequired, "");
  assert.equal(result[0].description, "search context");
  assert.equal(result[0].definitionOfDone, "search quality");
  assert.equal(result[0].acceptanceCriteria, "criteria");
  assert.equal(result[0].sprintId, "sprint-2");
  assert.equal(result[0].targetDate, "2026-10-10");
  assert.equal(result[0].fixedDate, "2026-10-11");
  assert.equal(result[0].parentTaskId, "initiative");
  assert.equal(result[0].assigneeId, "owner");
  assert.equal(result[0].status, "In Arbeit");
  assert.equal(result[0].priority, "P1");
  assert.equal(result[0].workstream, "Engineering");
  assert.equal(result[0].dependsOn, "waiting");
  const [subIssue] = mapPlanningSummaryRows([{ id: "child", task_type: "sub_issue", problem_statement: "legacy context" }], [], [], [], []);
  assert.equal(subIssue.description, "legacy context");
});


function deferred() {
  let resolve, reject;
  const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}

const { withWorkspaceProfileAvatars: enrichProfiles } = await importTestModule(
  "src/features/planning-items/server/workspace-profile-avatars.ts",
  { "server-only": {} },
);

async function controlledReader(enrich = enrichProfiles) {
  vi.useFakeTimers();
  const fixture = createSupabaseFixture();
  const reads = new Map();
  const executions = new Map();
  const rpc = deferred();
  const rpcCalls = [];
  const phases = [];
  const from = fixture.from;
  fixture.from = (table) => {
    const query = from(table);
    const read = deferred();
    reads.set(table, read);
    query.then = (resolve, reject) => {
      executions.set(table, (executions.get(table) || 0) + 1);
      return read.promise.then(resolve, reject);
    };
    return query;
  };
  fixture.rpc = (name, params) => { rpcCalls.push([name, params]); return rpc.promise; };
  const { loadPlanningWorkspaceModel: load } = await importTestModule(
    "src/features/planning-items/server/planning-workspace-read-source.ts",
    {
      ...moduleStubs,
      "@/features/planning-items/server/workspace-profile-avatars": { withWorkspaceProfileAvatars: enrich },
      "@/lib/runtime-logging": {
        observeRuntimePhase: async (name, run) => {
          const phase = { name, started: Date.now(), ended: null };
          phases.push(phase);
          try { return await run(); } finally { phase.ended = Date.now(); }
        },
        observeRuntimePreparation: (run) => run(),
      },
    },
  );
  const resolveRead = (table, result = { data: fixture.data[table], error: null }) => reads.get(table).resolve(result);
  const resolveOtherReads = (except = []) => {
    for (const table of reads.keys()) if (!except.includes(table)) resolveRead(table);
  };
  return { fixture, reads, executions, rpc, rpcCalls, phases, resolveRead, resolveOtherReads,
    load: () => load(fixture, { authorized: true, actorProfileId: "person" }) };
}

const flushScheduling = () => vi.advanceTimersByTimeAsync(0);
afterEach(() => vi.useRealTimers());

async function measureAvatarSchedule(profileTime, serial = false) {
  const fixture = await controlledReader();
  fixture.fixture.rpc = (name, params) => {
    fixture.rpcCalls.push([name, params]);
    return new Promise((resolve) => setTimeout(() => resolve({ data: [null], error: null }), 200));
  };
  // Characterize the previous dependency: all nine reads, then enrichment.
  const loadSerialReference = async () => {
    const tables = Object.keys(fixture.fixture.data);
    const results = await Promise.all(tables.map((table) => fixture.fixture.from(table)));
    const profiles = results[tables.indexOf("profiles")].data.map(moduleStubs["@/lib/planning-profile-mappers"].mapProfile);
    return { people: await enrichProfiles(profiles, fixture.fixture) };
  };
  let completedAt = null;
  const started = Date.now();
  const result = (serial ? loadSerialReference() : fixture.load()).then((value) => {
    completedAt = Date.now() - started;
    return value;
  });
  await flushScheduling();
  assert.equal(fixture.executions.size, 9);
  assert.ok([...fixture.executions.values()].every((count) => count === 1));
  setTimeout(() => fixture.resolveRead("profiles"), profileTime);
  setTimeout(() => fixture.resolveOtherReads(["profiles"]), 300);
  await vi.advanceTimersByTimeAsync(profileTime);
  assert.equal(fixture.rpcCalls.length, serial && profileTime < 300 ? 0 : 1);
  assert.equal(completedAt, null);
  await vi.advanceTimersByTimeAsync(500 - profileTime);
  const value = await result;
  if (!serial) assert.equal(value.status, "ready");
  assert.deepEqual(serial ? value.people : value.model.people, [{ id: "person", name: "Person", githubLogin: "person-login" }]);
  assert.deepEqual(fixture.rpcCalls, [["workspace_access_contexts", { p_profile_ids: ["person"] }]]);
  return completedAt;
}

test.each([100, 300])("avatar scheduling preserves the model and request budget with profiles at %i ms", async (profileTime) => {
  const overlapped = await measureAvatarSchedule(profileTime);
  const serial = await measureAvatarSchedule(profileTime, true);
  assert.equal(serial, 500);
  assert.equal(overlapped, profileTime === 100 ? 300 : 500);
});

test("avatar cleanup keeps both the reader and avatar phase open after RPC data arrives", async () => {
  const fixture = await controlledReader();
  const cleanup = deferred();
  const transport = deferred();
  fixture.fixture.rpc = () => transport.promise.finally(() => cleanup.promise);
  let settled = false;
  const result = fixture.load().then((value) => { settled = true; return value; });
  fixture.resolveOtherReads();
  await flushScheduling();
  transport.resolve({ data: [null], error: null });
  await flushScheduling();
  assert.equal(settled, false);
  assert.equal(fixture.phases.find(({ name }) => name === "board.avatars").ended, null);
  cleanup.resolve();
  assert.equal((await result).status, "ready");
  assert.notEqual(fixture.phases.find(({ name }) => name === "board.avatars").ended, null);
});

test.each(["result", "rejection", "missing-project"])("known base failure (%s) prevents a later avatar start", async (failure) => {
  const fixture = await controlledReader();
  const error = new Error("base failed first");
  const result = fixture.load();
  const observed = result.then((value) => ({ value }), (reason) => ({ reason }));
  if (failure === "rejection") fixture.reads.get("active_tasks").reject(error);
  else fixture.resolveRead(failure === "missing-project" ? "projects" : "active_tasks", { data: null, error: failure === "result" ? error : null });
  await flushScheduling();
  if (failure === "rejection") assert.deepEqual(await observed, { reason: error });
  fixture.resolveOtherReads([failure === "missing-project" ? "projects" : "active_tasks"]);
  await flushScheduling();
  assert.deepEqual(fixture.rpcCalls, []);
  assert.deepEqual(await observed, failure === "rejection" ? { reason: error } : { value: { status: "unavailable" } });
});

test.each(["empty", "result", "rejection"])("profiles %s never dispatch avatars", async (failure) => {
  const fixture = await controlledReader();
  const error = new Error("profile read failed");
  const result = fixture.load();
  const observed = result.then((value) => ({ value }), (reason) => ({ reason }));
  if (failure === "rejection") fixture.reads.get("profiles").reject(error);
  else fixture.resolveRead("profiles", { data: [], error: failure === "result" ? error : null });
  fixture.resolveOtherReads(["profiles"]);
  const outcome = await observed;
  assert.deepEqual(fixture.rpcCalls, []);
  if (failure === "empty") {
    assert.equal(outcome.value.status, "ready");
    assert.deepEqual(outcome.value.model.people, []);
  } else assert.deepEqual(outcome, failure === "rejection" ? { reason: error } : { value: { status: "unavailable" } });
});

test.each(["result", "rejection"])("late base %s waits for started avatar cleanup and retains base priority", async (failure) => {
  const avatar = deferred();
  const fixture = await controlledReader(() => avatar.promise);
  const error = Object.assign(new Error("base priority"), { code: "42501" });
  let settled = false;
  const result = fixture.load().then((value) => ({ value }), (reason) => ({ reason })).then((outcome) => { settled = true; return outcome; });
  fixture.resolveRead("profiles");
  await flushScheduling();
  if (failure === "rejection") fixture.reads.get("active_tasks").reject(error);
  else {
    fixture.resolveRead("active_tasks", { data: null, error });
    fixture.resolveOtherReads(["active_tasks", "profiles"]);
  }
  await flushScheduling();
  assert.equal(settled, false);
  if (failure === "rejection") fixture.reads.get("task_links").reject(new Error("later base failure"));
  avatar.reject(new Error("avatar must not win"));
  const outcome = await result;
  assert.deepEqual(outcome, failure === "rejection" ? { reason: error } : { value: { status: "unavailable" } });
  if (failure === "rejection") assert.equal(fixture.phases.find(({ name }) => name === "board.project").ended, null);
});

test("unexpected avatar rejection is observed while base reads remain open and is propagated after their success", async () => {
  const avatar = deferred();
  const fixture = await controlledReader(() => avatar.promise);
  const error = new Error("unexpected avatar failure");
  const result = fixture.load();
  const observed = result.then((value) => ({ value }), (reason) => ({ reason }));
  fixture.resolveRead("profiles");
  await flushScheduling();
  avatar.reject(error);
  await flushScheduling();
  fixture.resolveOtherReads(["profiles"]);
  assert.deepEqual(await observed, { reason: error });
});

test.each(["42501", "AbortError"])("real avatar fallback preserves profiles after %s and waits for transport cleanup", async (failure) => {
  const fixture = await controlledReader();
  const cleanup = deferred();
  fixture.fixture.rpc = (name, params) => {
    fixture.rpcCalls.push([name, params]);
    return fixture.rpc.promise.finally(() => cleanup.promise);
  };
  let settled = false;
  const result = fixture.load().then((value) => { settled = true; return value; });
  fixture.resolveOtherReads();
  await flushScheduling();
  if (failure === "AbortError") fixture.rpc.reject(new DOMException("Cancelled", "AbortError"));
  else fixture.rpc.resolve({ data: null, error: { code: failure } });
  await flushScheduling();
  assert.equal(settled, false);
  cleanup.resolve();
  const value = await result;
  assert.equal(value.status, "ready");
  assert.deepEqual(value.model.people, [{ id: "person", name: "Person", githubLogin: "person-login" }]);
  assert.equal(fixture.rpcCalls.length, 1);
});


test.each(["PGRST202", "42883"])("early avatars retain the existing batch fallback budget for %s", async (code) => {
  const fixture = await controlledReader();
  fixture.fixture.data.profiles.push({ id: "other", name: "Other" });
  const calls = [];
  fixture.fixture.rpc = async (name, params) => {
    calls.push([name, params]);
    return name === "workspace_access_contexts"
      ? { data: null, error: { code } }
      : { data: null, error: params.p_profile_id === "other" ? { code: "42501" } : null };
  };
  const result = fixture.load();
  fixture.resolveRead("profiles");
  await flushScheduling();
  assert.deepEqual(calls, [
    ["workspace_access_contexts", { p_profile_ids: ["person", "other"] }],
    ["workspace_access_context", { p_profile_id: "person" }],
    ["workspace_access_context", { p_profile_id: "other" }],
  ]);
  fixture.resolveOtherReads(["profiles"]);
  const value = await result;
  assert.equal(value.status, "ready");
  assert.deepEqual(value.model.people.map(({ id }) => id), ["person", "other"]);
});
