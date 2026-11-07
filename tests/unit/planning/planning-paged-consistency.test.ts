import { expect, test } from "vitest";
import { createPlanningState, type PlanningStateAdapter, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn, type PlanningBoardQueryInput } from "@/features/planning/model/planning-board-query";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskStatuses } from "@/lib/status";
import type { Sprint, Task, TaskStatus } from "@/lib/types";

const session = { userId: "reader", user: { id: "reader" }, revision: "session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
const card = { id: "card", title: "Current card", status: "Offen", taskType: "deliverable", approvalStatus: "approved", updatedAt: "r1", order: 0 } as Task;
const history = { ...card, id: "history", title: "Historical card", status: "Erledigt" };
function read(input: PlanningBoardQueryInput = {}, items = [card, history], revision = "r1"): PlanningWorkspaceRead {
  const query = normalizePlanningBoardQuery(input);
  const columns = Object.fromEntries([...taskStatuses, "Pausiert"].map(status => [status, {
    total: status === "Offen" ? 1 : status === "Erledigt" ? 25 : 0,
    loaded: items.filter(item => item.status === status).length,
    completeness: status === "Erledigt" ? "partial" : "complete", continuation: status === "Erledigt" ? "next" : null,
  } satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>;
  return { query, queryRevision: revision, scopeRevision: `scope-${revision}`, data: { ...emptyPlanningShellState, tasks: items }, coverage: { tasks: "partial", profiles: "complete", sprints: "complete", taskRelations: "partial", taskBlockers: "partial" },
    board: { query, queryKey: planningBoardQueryKey(query), column: input.column, revision, observedAt: "2026-11-07T00:00:00Z", cardIds: items.map(item => item.id), columns,
      childProgressById: { card: { total: 2, completed: 1, unfinished: 1, percentage: 50 } }, metrics: { total: 26, open: 1, done: 25, blocked: 0 }, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 26, latestUpdatedAt: "r1" } },
  };
}
function owner(adapter: Partial<PlanningStateAdapter> = {}, initial = read()) {
  return createPlanningState({ userId: session.userId, initialData: initial.data, initialSession: session,
    initialWorkspaceRead: { workspace: "planning", session, revision: "r1", queryKey: initial.board!.queryKey, query: initial.board!.query, queryRevision: "r1", scopeRevision: initial.scopeRevision, board: initial.board, coverage: initial.coverage!, taskOmittedFields: [] },
    adapter: { saveTask: async (task, patch) => ({ task: { ...task, ...patch, updatedAt: "r2" } }), readWorkspace: async (_, query) => read(query), ...adapter },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("a confirmed status move invalidates its column metadata and rejects an older page without losing the Item", async () => {
  const page = deferred<PlanningWorkspaceRead>();
  const { planning } = owner({ readWorkspace: () => page.promise });
  const reading = planning.loadBoardColumn("Erledigt");
  await expect(planning.saveTask(card, { status: "Erledigt" })).resolves.toMatchObject({ ok: true });
  expect(planning.board().columnReadStatus).toMatchObject({ Offen: "stale", Erledigt: "stale" });
  expect(planning.board().result?.columns.Erledigt.continuation).toBeNull();
  page.resolve(read({ column: "Erledigt", continuation: "next" }, [{ ...history, id: "late" }]));
  await expect(reading).resolves.toBe(false);
  expect(planning.board().tasks.map(item => item.id)).toEqual(["card", "history"]);
  expect(planning.taskDetail(card.id).task).toMatchObject({ status: "Erledigt", updatedAt: "r2" });
  expect(planning.board().readStatus).toBe("stale");
});

test("a confirmed Sprint edit invalidates retained Board coverage even without a task receipt", async () => {
  const sprint = { id: "sprint", name: "Old Sprint", startDate: "2026-11-01", endDate: "2026-11-14", updatedAt: "r1" } as Sprint;
  const complete = { ...read({ view: "complete" }), board: undefined, coverage: { tasks: "complete", profiles: "complete", sprints: "complete", taskRelations: "complete", taskBlockers: "complete" } as const };
  const reads: PlanningBoardQueryInput[] = [];
  const { planning } = owner({
    readWorkspace: async (_, query = {}) => { reads.push(query); return query.view === "complete" ? { ...complete, data: { ...complete.data, sprints: [sprint] } } : read(query); },
    saveSprint: async (_, patch) => ({ sprint: { ...sprint, ...patch, updatedAt: "r2" } }),
  });
  await planning.ensureBoardQuery({ view: "complete" });
  await expect(planning.beginSprintEdit(sprint).save({ name: "Renamed Sprint" })).resolves.toMatchObject({ ok: true });
  await planning.ensureBoardQuery({ view: "board" });
  expect(reads).toHaveLength(2);
});

test("authority replacement immediately detaches cards, detail and metadata and rejects previous detail responses", async () => {
  const detail = deferred<Awaited<ReturnType<NonNullable<PlanningStateAdapter["readTaskDetail"]>>>>();
  const state = owner({ readTaskDetail: () => detail.promise });
  const reading = state.planning.loadTaskDetail(card.id);
  state.internal.bindSession({ ...session, revision: "new-authority" });
  expect(state.planning.board().result).toBeUndefined();
  expect(state.planning.board().scopeRevision).toBeUndefined();
  expect(state.planning.board().tasks).toEqual([]);
  expect(state.planning.taskDetail(card.id).task).toBeNull();
  detail.resolve({ model: { revision: "r1", project: emptyPlanningShellState.project, item: card, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] } });
  await expect(reading).resolves.toMatchObject({ ok: false });
  expect(state.planning.taskDetail(card.id).task).toBeNull();
});

test("denied child details detach their aggregate metadata and cannot be restored by an older Board page", async () => {
  const page = deferred<PlanningWorkspaceRead>();
  const { planning } = owner({ readWorkspace: () => page.promise, readTaskDetail: async () => { throw Object.assign(new Error("Denied"), { status: 403 }); } });
  const reading = planning.loadBoardColumn("Erledigt");
  await expect(planning.loadTaskDetail(card.id)).resolves.toMatchObject({ ok: false });
  expect(planning.taskDetail(card.id)).toMatchObject({ task: null, children: [], childrenReadStatus: "forbidden" });
  expect(planning.board().result).toBeUndefined();
  expect(planning.board().queryKey).toBeUndefined();
  expect(planning.board().columnReadStatus).toEqual({});
  page.resolve(read({ column: "Erledigt", continuation: "next" }));
  await expect(reading).resolves.toBe(false);
  expect(planning.board().result).toBeUndefined();
});

test("a stale continuation retries the affected column from its start and keeps useful detail", async () => {
  const queries: PlanningBoardQueryInput[] = [];
  const { planning } = owner({ readWorkspace: async (_, query = {}) => {
    queries.push(query);
    if (query.continuation) throw Object.assign(new Error("Source changed"), { code: "stale_continuation", status: 409 });
    return read(query, [{ ...history, id: "current-history" }], "r2");
  } });
  await expect(planning.loadBoardColumn("Erledigt")).resolves.toBe(false);
  expect(planning.board().tasks).toHaveLength(2);
  await expect(planning.loadBoardColumn("Erledigt")).resolves.toBe(true);
  expect(queries).toHaveLength(2);
  expect(queries[1]).toMatchObject({ column: "Erledigt" });
  expect(queries[1].continuation).toBeUndefined();
  expect(planning.board().tasks.map(item => item.id)).toEqual(["card", "current-history"]);
  expect(planning.taskDetail(history.id).task).toMatchObject({ id: "history" });
  expect(planning.board().columnReadStatus?.Offen).toBe("stale");
});

test("an authoritative detail change invalidates Board aggregates without treating an unloaded identity as removed", async () => {
  const { planning } = owner({ readTaskDetail: async () => ({ model: { revision: "r2", project: emptyPlanningShellState.project, item: { ...card, status: "Erledigt", updatedAt: "r2" }, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] } }) });
  await planning.loadTaskDetail(card.id);
  expect(planning.board().readStatus).toBe("stale");
  expect(planning.board().result?.columns.Erledigt.continuation).toBeNull();
  expect(planning.taskDetail(card.id).task).toMatchObject({ status: "Erledigt", updatedAt: "r2" });
  expect(planning.taskDetail("not-loaded").removed).toBe(false);
});

test("a status move leaves a filtered Board membership while retaining its canonical detail", async () => {
  const { planning } = owner({}, read({ filters: { status: "Offen" } }, [card]));
  await planning.saveTask(card, { status: "Erledigt" });
  expect(planning.board().tasks).toEqual([]);
  expect(planning.board().result?.columns.Offen.loaded).toBe(0);
  expect(planning.taskDetail(card.id)).toMatchObject({ task: { status: "Erledigt" }, removed: false });
});

test("confirmed removal invalidates counts and an older page cannot resurrect its card or detail", async () => {
  const page = deferred<PlanningWorkspaceRead>();
  const { planning } = owner({ readWorkspace: () => page.promise, removeTask: async () => ({ affectedTaskIds: [card.id] }) });
  const reading = planning.loadBoardColumn("Erledigt");
  await expect(planning.withdrawTask(card, "Confirmed removal")).resolves.toMatchObject({ ok: true });
  page.resolve(read({ column: "Erledigt", continuation: "next" }));
  await expect(reading).resolves.toBe(false);
  expect(planning.board().tasks.map(item => item.id)).toEqual([history.id]);
  expect(planning.board().columnReadStatus?.Offen).toBe("stale");
  expect(planning.taskDetail(card.id)).toMatchObject({ task: null, removed: true });
});

test("identical query reads still coalesce when an independent detail request starts", async () => {
  const response = deferred<PlanningWorkspaceRead>();
  let queries = 0;
  const { planning } = owner({ readWorkspace: () => { queries++; return response.promise; }, readTaskDetail: async () => ({ model: { revision: "r1", project: emptyPlanningShellState.project, item: history, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] } }) });
  const query = { filters: { priority: "P0" } };
  const first = planning.ensureBoardQuery(query);
  await planning.loadTaskDetail(history.id);
  const second = planning.ensureBoardQuery(query);
  expect(queries).toBe(1);
  response.resolve(read(query));
  await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
});

test("a rejected query response cannot replace source metadata or leave a column loading", async () => {
  const { planning } = owner({ readWorkspace: async (_, query) => {
    const result = read(query);
    return { ...result, scopeRevision: "unrelated-source", board: { ...result.board!, queryKey: "another-query" } };
  } });
  await expect(planning.loadBoardColumn("Erledigt")).resolves.toBe(false);
  expect(planning.board().scopeRevision).toBe("scope-r1");
  expect(planning.board().columnReadStatus?.Erledigt).toBe("unavailable");
  expect(planning.board().tasks).toHaveLength(2);
});

test("an older independent page retains the newer accepted scope proof", async () => {
  const older = deferred<PlanningWorkspaceRead>();
  const { planning } = owner({ readWorkspace: async (_, query = {}) => query.column === "Erledigt" ? older.promise : { ...read(query, [card]), scopeRevision: "newer-proof" } });
  const reading = planning.loadBoardColumn("Erledigt");
  await planning.refreshBoardColumn("Offen");
  older.resolve({ ...read({ column: "Erledigt", continuation: "next" }, [{ ...history, id: "later-card" }]), scopeRevision: "older-proof" });
  await expect(reading).resolves.toBe(true);
  expect(planning.board().scopeRevision).toBe("newer-proof");
  expect(planning.board().tasks.map(task => task.id)).toEqual(["history", "card", "later-card"]);
});

test("an older detail context cannot republish a subsequently denied target", async () => {
  const related = deferred<Awaited<ReturnType<NonNullable<PlanningStateAdapter["readTaskDetail"]>>>>();
  const { planning } = owner({ readTaskDetail: id => {
    if (id === history.id) return related.promise;
    return Promise.reject(Object.assign(new Error("Denied"), { status: 403 }));
  } });
  const reading = planning.loadTaskDetail(history.id);
  await planning.loadTaskDetail(card.id);
  expect(planning.taskDetail(card.id).task).toBeNull();
  related.resolve({ model: { revision: "r1", project: emptyPlanningShellState.project, item: history, ancestors: [], children: [], relatedItems: [card], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] } });
  await reading;
  expect(planning.taskDetail(card.id).task).toBeNull();
  expect(planning.board().result).toBeUndefined();
});

test("a Board denial also rejects a detail target that was already loading", async () => {
  const detail = deferred<Awaited<ReturnType<NonNullable<PlanningStateAdapter["readTaskDetail"]>>>>();
  const { planning } = owner({ readWorkspace: async () => { throw Object.assign(new Error("Denied"), { status: 403 }); }, readTaskDetail: () => detail.promise });
  const reading = planning.loadTaskDetail(card.id);
  await planning.refreshWorkspace("planning");
  detail.resolve({ model: { revision: "r1", project: emptyPlanningShellState.project, item: card, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] } });
  await expect(reading).resolves.toMatchObject({ ok: false });
  expect(planning.taskDetail(card.id)).toMatchObject({ task: null, readStatus: "forbidden" });
  expect(planning.board().result).toBeUndefined();
});
