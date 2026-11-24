import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskStatuses } from "@/lib/status";
import type { Task } from "@/lib/types";
import { planningWorkspaceHydration } from "@/features/planning/model/planning-workspace-hydration";

const task = { id: "entry-task", title: "Working task", updatedAt: "r1", taskType: "deliverable" } as Task;
const data = { ...emptyPlanningShellState, tasks: [task] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("concurrent consumers share a complete workspace read and both observe its accepted result", async () => {
  const response = deferred<{ data: typeof data; taskCoverage: "complete" }>();
  let requests = 0;
  const { planning } = createPlanningState({ userId: "entry-user", initialData: data, adapter: {
    saveTask: async () => ({ task }),
    readWorkspace: () => { requests++; return response.promise; },
  } });
  const first = planning.refreshWorkspace("planning");
  const second = planning.refreshWorkspace("planning");
  expect(planning.workspace("planning").tasks).toEqual([task]);
  expect(requests).toBe(1);
  response.resolve({ data: { ...data, tasks: [{ ...task, title: "Current task", updatedAt: "r2" }] }, taskCoverage: "complete" });
  await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  expect(planning.workspace("planning")).toMatchObject({ tasks: [{ title: "Current task" }], readStatus: "current", completeness: "complete" });
});

test("a confirmed edit requires a newer workspace read and its result survives the older response", async () => {
  const old = deferred<{ data: typeof data }>();
  let requests = 0;
  const { planning } = createPlanningState({ userId: "entry-user", initialData: data, adapter: {
    saveTask: async () => ({ task: { ...task, title: "Confirmed edit", updatedAt: "r2" } }),
    readWorkspace: () => ++requests === 1 ? old.promise : Promise.resolve({ data: { ...data, tasks: [{ ...task, title: "Current result", updatedAt: "r3" }] } }),
  } });
  const first = planning.refreshWorkspace("planning");
  await planning.saveTask(task, { title: "Confirmed edit" });
  await expect(planning.refreshWorkspace("planning")).resolves.toBe(true);
  expect(requests).toBe(2);
  old.resolve({ data });
  await expect(first).resolves.toBe(false);
  expect(planning.workspace("planning").tasks).toMatchObject([{ title: "Current result", updatedAt: "r3" }]);
});

test("a failed shared read retains usable cards and a later refresh retries the boundary", async () => {
  const failed = deferred<null>();
  let requests = 0;
  const { planning } = createPlanningState({ userId: "entry-user", initialData: data, adapter: {
    saveTask: async () => ({ task }),
    readWorkspace: () => ++requests === 1 ? failed.promise : Promise.resolve({ data }),
  } });
  const first = planning.refreshWorkspace("planning");
  const second = planning.refreshWorkspace("planning");
  failed.resolve(null);
  await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
  expect(planning.workspace("planning")).toMatchObject({ tasks: [task], readStatus: "unavailable" });
  await expect(planning.refreshWorkspace("planning")).resolves.toBe(true);
  expect(requests).toBe(2);
  expect(planning.workspace("planning").readStatus).toBe("current");
});

test.each(["complete", "partial"] as const)("the initial Board retains its declared %s coverage", coverage => {
  const session = { userId: "entry-user", revision: "entry-session", expiresAt: Math.floor(Date.now() / 1000) + 60, user: { id: "entry-user" } };
  const read = planningWorkspaceHydration("planning", { revision: "r1", project: data.project, items: [task], people: [], sprints: [], relationships: [], preferences: [], coverage: { items: coverage } }, session, { userId: session.userId, deadline: session.expiresAt * 1000 });
  const { planning } = createPlanningState({ userId: session.userId, initialData: data, initialSession: session, initialWorkspaceRead: read,
    adapter: { saveTask: async () => ({ task }), readWorkspace: async () => null },
  });
  expect(planning.workspace("planning")).toMatchObject({ tasks: [task], readStatus: "current", completeness: coverage });
});


test("returning with sufficient bound Planning content observes freshness without an equivalent content read", async () => {
  const session = { userId: "entry-user", revision: "entry-session", expiresAt: Math.floor(Date.now() / 1000) + 60, user: { id: "entry-user" } };
  const model = { revision: "r1", scopeRevision: "source-1", project: data.project, items: [task], people: [], sprints: [], relationships: [], preferences: [], coverage: { items: "complete" as const } };
  const read = planningWorkspaceHydration("planning", model, session, { userId: session.userId, deadline: session.expiresAt * 1000 })!;
  let contentReads = 0;
  let versionReads = 0;
  const owner = createPlanningState({ userId: session.userId, initialData: data, initialSession: session, initialWorkspaceRead: read, adapter: {
    saveTask: async () => ({ task }),
    readWorkspace: async () => { contentReads++; return { data }; },
    readPlanningSourceVersion: async () => { versionReads++; return "source-1"; },
  } });
  // A cached server page is not a new ordered request. Its differing payload cannot replace accepted content.
  owner.internal.acceptHydration({ ...data, tasks: [{ ...task, title: "Cached page" }] }, session.userId, "planning", read);
  await owner.planning.checkPlanningSource();
  expect(owner.planning.workspace("planning")).toMatchObject({ tasks: [task], readStatus: "current", completeness: "complete" });
  expect({ contentReads, versionReads }).toEqual({ contentReads: 0, versionReads: 1 });
});


function sourceOwner(options: { version?: () => Promise<string>; expiresAt?: number; now?: () => number; workspace?: "planning" | "events" } = {}) {
  const session = { userId: "entry-user", revision: "entry-session", expiresAt: options.expiresAt || Math.floor(Date.now() / 1000) + 60, user: { id: "entry-user" } };
  const read = planningWorkspaceHydration("planning", { revision: "r1", scopeRevision: "source-1", project: data.project, items: [task], people: [], sprints: [], relationships: [], preferences: [], coverage: { items: "complete" } }, session, { userId: session.userId, deadline: session.expiresAt * 1000 })!;
  let contentReads = 0;
  const owner = createPlanningState({ userId: session.userId, initialData: data, initialWorkspace: options.workspace, initialSession: session, initialWorkspaceRead: options.workspace ? undefined : read, adapter: {
    now: options.now, saveTask: async () => ({ task }),
    readPlanningSourceVersion: options.version || (async () => "source-1"),
    readWorkspace: async () => { contentReads++; return { data, scopeRevision: "source-2", taskCoverage: "complete" }; },
  } });
  return { ...owner, session, read, contentReads: () => contentReads };
}

test("missing Planning coverage goes directly to content rather than observing a version first", async () => {
  let versions = 0;
  const owner = sourceOwner({ workspace: "events", version: async () => { versions++; return "source-1"; } });
  await expect(owner.planning.checkPlanningSource()).resolves.toBe("content-read");
  expect({ versions, content: owner.contentReads() }).toEqual({ versions: 0, content: 1 });
  expect(owner.planning.workspace("planning")).toMatchObject({ readStatus: "current", completeness: "complete", tasks: [task] });
});

test("a changed source invalidates accepted coverage and the next required read goes directly to content", async () => {
  const owner = sourceOwner({ version: async () => "source-2" });
  await expect(owner.planning.checkPlanningSource()).resolves.toBe("changed");
  expect(owner.planning.board()).toMatchObject({ freshness: "stale", sourceStatus: "changed" });
  expect(owner.planning.workspace("planning").tasks).toEqual([task]);
  await expect(owner.planning.checkPlanningSource()).resolves.toBe("content-read");
  expect(owner.contentReads()).toBe(1);
});

test("a failed version observation retains content with unverified freshness and no complete fallback", async () => {
  const owner = sourceOwner({ version: async () => { throw new Error("offline"); } });
  await expect(owner.planning.checkPlanningSource()).resolves.toBe("unverified");
  expect(owner.planning.board()).toMatchObject({ sourceStatus: "unverified", tasks: [task] });
  expect(owner.contentReads()).toBe(0);
});

test.each(["expiry", "replacement"] as const)("late unchanged observations cannot renew %s authority", async transition => {
  let now = 1_000;
  const version = deferred<string>();
  const owner = sourceOwner({ expiresAt: 2, now: () => now, version: () => version.promise });
  const observed = owner.planning.checkPlanningSource();
  if (transition === "expiry") now = 2_001;
  else owner.internal.bindSession({ ...owner.session, revision: "replacement", expiresAt: 5 });
  version.resolve("source-1");
  await expect(observed).resolves.toBe("session-ended");
  expect(owner.planning.workspace("planning").tasks).toEqual([]);
  expect(owner.contentReads()).toBe(0);
});

test("a current-scope version denial removes cards instead of presenting reusable denied data", async () => {
  const owner = sourceOwner({ version: async () => { throw Object.assign(new Error("denied"), { status: 403 }); } });
  await owner.planning.checkPlanningSource();
  expect(owner.planning.workspace("planning")).toMatchObject({ tasks: [], readStatus: "forbidden" });
  expect(owner.contentReads()).toBe(0);
});

test("freshness demand joins an already required query read without observing the old source", async () => {
  const session = { userId: "entry-user", revision: "entry-session", expiresAt: Math.floor(Date.now() / 1000) + 60, user: { id: "entry-user" } };
  const read = planningWorkspaceHydration("planning", { revision: "r1", scopeRevision: "source-1", project: data.project, items: [task], people: [], sprints: [], relationships: [], preferences: [], coverage: { items: "complete" } }, session, { userId: session.userId, deadline: session.expiresAt * 1000 })!;
  const pending = deferred<{ data: typeof data; scopeRevision: string; query: { filters: { query: string } } }>();
  let versionReads = 0;
  const { planning } = createPlanningState({ userId: session.userId, initialData: data, initialSession: session, initialWorkspaceRead: read, adapter: {
    saveTask: async () => ({ task }), readWorkspace: () => pending.promise,
    readPlanningSourceVersion: async () => { versionReads++; return "source-1"; },
  } });
  const query = planning.ensureBoardQuery({ filters: { query: "changed query" } });
  const observed = planning.checkPlanningSource();
  pending.resolve({ data, scopeRevision: "source-2", query: { filters: { query: "changed query" } } });
  await expect(query).resolves.toBe(true);
  await expect(observed).resolves.toBe("content-read");
  expect(versionReads).toBe(0);
  expect(planning.board().scopeRevision).toBe("source-2");
});

test.each([
  { name: "Sprint end", startDate: "2026-11-10", endDate: "2026-11-13", before: [task.id], after: [] },
  { name: "rolling seven-day start", startDate: "2026-11-20", endDate: "2026-11-27", before: [], after: [task.id] },
].flatMap(sample => ["observation", "query", "page"].map(demand => ({ ...sample, demand }))))("$name expiry requests week content directly for $demand despite an unchanged source", async sample => {
  const observedAt = "2026-11-12T23:59:59.000Z";
  let now = Date.parse(observedAt);
  const session = { userId: "entry-user", revision: "entry-session", expiresAt: Date.parse("2026-11-13T01:00:00Z") / 1000, user: { id: "entry-user" } };
  const { normalizePlanningBoardQuery, planningBoardQueryKey } = await import("@/features/planning/model/planning-board-query");
  const query = normalizePlanningBoardQuery({ filters: { quick: ["week"] } });
  const columns = Object.fromEntries([...taskStatuses, "Pausiert"].map(status => [status, { total: status === "Offen" ? sample.before.length : 0, loaded: status === "Offen" ? sample.before.length : 0, completeness: "complete", continuation: null }])) as import("@/features/planning/model/planning-board-query").PlanningBoardResult["columns"];
  const board: import("@/features/planning/model/planning-board-query").PlanningBoardResult = { query, queryKey: planningBoardQueryKey(query), revision: "query-1", observedAt, cardIds: sample.before, columns, childProgressById: {}, metrics: { total: sample.before.length, open: sample.before.length, blocked: 0, done: 0 }, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 1, latestUpdatedAt: "r1" } };
  const sprints = [{ id: "week-sprint", name: "Synthetic Sprint", status: "planning", startDate: sample.startDate, endDate: sample.endDate, reviewDueAt: "", scoreLocked: false }] as import("@/lib/types").Sprint[];
  const initial = { ...data, tasks: [{ ...task, sprintId: "week-sprint" }], sprints };
  const read = planningWorkspaceHydration("planning", { revision: "r1", scopeRevision: "source-1", board, query, project: data.project, items: initial.tasks, people: [], sprints, relationships: [], preferences: [], coverage: { items: "complete", sprints: "complete" } }, session, { userId: session.userId, deadline: session.expiresAt * 1000 })!;
  let contents = 0, versions = 0;
  const { planning } = createPlanningState({ userId: session.userId, initialData: initial, initialSession: session, initialWorkspaceRead: read, adapter: {
    now: () => now, saveTask: async () => ({ task }),
    readPlanningSourceVersion: async () => { versions++; return "source-1"; },
    readWorkspace: async (_workspace, requestedQuery) => {
      contents++;
      expect(requestedQuery).toEqual(query);
      return { data: initial, scopeRevision: "source-1", query, board: { ...board, observedAt: new Date(now).toISOString(), cardIds: sample.after, metrics: { total: sample.after.length, open: sample.after.length, blocked: 0, done: 0 } }, coverage: { tasks: "complete", sprints: "complete" } };
    },
  } });
  await expect(planning.checkPlanningSource()).resolves.toBe("unchanged");
  expect({ contents, versions }).toEqual({ contents: 0, versions: 1 });
  now = Date.parse("2026-11-13T00:00:00.001Z");
  if (sample.demand === "observation") await expect(planning.checkPlanningSource()).resolves.toBe("content-read");
  else if (sample.demand === "query") await expect(planning.ensureBoardQuery(query)).resolves.toBe(true);
  else await expect(planning.loadBoardColumn("Offen")).resolves.toBe(true);
  expect({ contents, versions }).toEqual({ contents: 1, versions: 1 });
  expect(planning.board().result?.cardIds).toEqual(sample.after);
});

test("week reuse without a complete Sprint time basis requests its scope and cannot certify source equality", async () => {
  const { normalizePlanningBoardQuery, planningBoardQueryKey } = await import("@/features/planning/model/planning-board-query");
  const { session, read } = sourceOwner();
  const query = normalizePlanningBoardQuery({ filters: { quick: ["week"] } });
  let contents = 0, versions = 0;
  const { planning } = createPlanningState({ userId: session.userId, initialData: data, initialSession: session,
    initialWorkspaceRead: { ...read, query, queryKey: planningBoardQueryKey(query), coverage: { ...read.coverage, sprints: "partial" } }, adapter: {
      saveTask: async () => ({ task }),
      readPlanningSourceVersion: async () => { versions++; return "source-1"; },
      readWorkspace: async (_workspace, requestedQuery) => { contents++; expect(requestedQuery).toEqual(query); return null; },
    },
  });
  await expect(planning.checkPlanningSource()).resolves.toBe("unverified");
  expect({ contents, versions }).toEqual({ contents: 1, versions: 0 });
  expect(planning.workspace("planning").readStatus).toBe("unavailable");
  expect(planning.board().freshness).toBe("stale");
});


test("the original Board read deadline expires before provider session expiry and equality cannot renew it", async () => {
  let now = 1_000, versions = 0, reads = 0;
  const session = { userId: "entry-user", revision: "original-session", expiresAt: 100, user: { id: "entry-user" } };
  const read = planningWorkspaceHydration("planning", { revision: "r1", scopeRevision: "source-1", project: data.project, items: [task], people: [], sprints: [], relationships: [], preferences: [], coverage: { items: "complete" } }, session, { userId: session.userId, deadline: 2_000 })!;
  const observed = deferred<string>();
  const owner = createPlanningState({ userId: session.userId, initialSession: session, initialWorkspaceRead: read, initialData: data, adapter: {
    now: () => now, saveTask: async () => ({ task }), readPlanningSourceVersion: () => { versions++; return observed.promise; },
    readWorkspace: async () => { reads++; return { data, scopeRevision: "source-1", readAuthority: { userId: session.userId, deadline: 5_000 } }; },
  } });
  const checking = owner.planning.checkPlanningSource();
  now = 2_000;
  observed.resolve("source-1");
  await expect(checking).resolves.toBe("session-ended");
  expect(owner.planning.workspace("planning").tasks).toEqual([]);
  owner.internal.acceptHydration(data, session.userId, "planning", read);
  expect(owner.planning.workspace("planning").tasks).toEqual([]);
  await expect(owner.planning.checkPlanningSource()).resolves.toBe("content-read");
  expect({ versions, reads }).toEqual({ versions: 1, reads: 1 });
  expect(owner.planning.workspace("planning").tasks).toEqual([task]);
  now = 5_000;
  expect(owner.planning.workspace("planning").tasks).toEqual([]);
});


test("legacy hydration without the original read receipt cannot certify retained authority", async () => {
  const { session, read } = sourceOwner();
  let versions = 0, contents = 0;
  const owner = createPlanningState({ userId: session.userId, initialSession: session, initialData: data, initialWorkspaceRead: { ...read, readAuthority: undefined }, adapter: {
    saveTask: async () => ({ task }),
    readPlanningSourceVersion: async () => { versions++; return "source-1"; },
    readWorkspace: async () => { contents++; return { data, readAuthority: { userId: session.userId, deadline: session.expiresAt * 1000 } }; },
  } });
  expect(owner.planning.workspace("planning").tasks).toEqual([]);
  await expect(owner.planning.checkPlanningSource()).resolves.toBe("content-read");
  expect({ versions, contents }).toEqual({ versions: 0, contents: 1 });
  expect(owner.planning.workspace("planning").tasks).toEqual([task]);
});

test.each([{ userId: "another-user", deadline: 3_000 }, { userId: "entry-user", deadline: 1_000 }, { userId: "entry-user", deadline: NaN }])("a Board response cannot accept an invalid original authority receipt %j", async readAuthority => {
  const owner = createPlanningState({ userId: "entry-user", initialData: emptyPlanningShellState, adapter: {
    now: () => 1_000, saveTask: async () => ({ task }), readWorkspace: async () => ({ data, readAuthority, scopeRevision: "unaccepted-source" }),
  } });
  await expect(owner.planning.refreshWorkspace("planning")).resolves.toBe(false);
  expect(owner.planning.workspace("planning").tasks).toEqual([]);
  expect(owner.planning.board().scopeRevision).toBeUndefined();
});
