import { expect, test } from "vitest";
import { createPlanningState, type PlanningStateAdapter, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn, type PlanningBoardQueryInput } from "@/features/planning/model/planning-board-query";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { Task, TaskStatus } from "@/lib/types";
import { taskStatuses } from "@/lib/status";

const session = { userId: "view-user", user: { id: "view-user" }, revision: "view-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
const cards = Array.from({ length: 45 }, (_, index) => ({ id: `done-${index}`, title: `Historical Deliverable ${index}`, taskType: "deliverable", status: "Erledigt", order: index, updatedAt: "r1" }) as Task);

function viewRead(input: PlanningBoardQueryInput = {}): PlanningWorkspaceRead {
  const query = normalizePlanningBoardQuery(input);
  const complete = query.view === "complete";
  const items = complete ? cards : cards.slice(input.continuation ? 20 : 0, input.continuation ? 40 : 20);
  const columns = Object.fromEntries([...taskStatuses, "Pausiert"].map(status => [status, {
    total: status === "Erledigt" ? 45 : 0, loaded: status === "Erledigt" ? items.length : 0,
    completeness: status === "Erledigt" ? "partial" : "complete", continuation: status === "Erledigt" ? input.continuation ? "page-3" : "page-2" : null,
  } satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>;
  return { data: { ...emptyPlanningShellState, tasks: items }, query, queryRevision: "r1", coverage: { tasks: complete ? "complete" : "partial", profiles: "complete", sprints: "complete", taskRelations: "complete", taskBlockers: "complete" },
    ...(!complete ? { board: { query, queryKey: planningBoardQueryKey(query), revision: "r1", observedAt: "2026-11-07T00:00:00Z", cardIds: items.map(task => task.id), columns, childProgressById: {}, viewerOpenSubIssueIdsByDeliverableId: {}, metrics: { total: 45, open: 0, done: 45, blocked: 0 }, workspaceRevision: { activeTaskCount: 45, latestUpdatedAt: "r1" } } } : {}),
  };
}

function ownerWithViews(readWorkspace: (query: PlanningBoardQueryInput) => Promise<PlanningWorkspaceRead> = async query => viewRead(query), adapter: Partial<PlanningStateAdapter> = {}) {
  const initial = viewRead();
  return createPlanningState({ userId: session.userId, initialData: initial.data, initialSession: session,
    initialWorkspaceRead: { workspace: "planning", session, revision: "r1", queryKey: initial.board!.queryKey, query: normalizePlanningBoardQuery(initial.query), board: initial.board, coverage: initial.coverage!, taskOmittedFields: [] },
    adapter: { saveTask: async task => ({ task }), readWorkspace: (_, query) => readWorkspace(query || {}), ...adapter },
  });
}

test("complete alternative views retain loaded Board pages and reuse complete coverage on the next visit", async () => {
  const reads: PlanningBoardQueryInput[] = [];
  const { planning } = ownerWithViews(async query => { reads.push(query); return viewRead(query); });
  await planning.loadCompletedHistory();
  expect(planning.board().tasks).toHaveLength(40);
  await planning.ensureBoardQuery({ view: "complete" });
  expect(planning.board().tasks).toHaveLength(45);
  await planning.ensureBoardQuery({ view: "board" });
  expect(planning.board().tasks).toHaveLength(40);
  expect(planning.board().result?.columns.Erledigt.continuation).toBe("page-3");
  await planning.ensureBoardQuery({ view: "complete" });
  expect(planning.board().tasks).toHaveLength(45);
  expect(reads).toHaveLength(2);
});

test("complete authorized coverage supports local filters and retained strategic Board context without another full read", async () => {
  const reads: PlanningBoardQueryInput[] = [];
  const { planning } = ownerWithViews(async query => { reads.push(query); return viewRead(query); });
  await planning.ensureBoardQuery({ view: "complete" });
  await planning.ensureBoardQuery({ view: "complete", level: "initiative", parentId: "retained-epic", filters: { query: "Historical Deliverable 44", sort: "title", direction: "desc" } });
  expect(planning.board().tasks).toHaveLength(45);
  expect(reads).toHaveLength(1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("a complete empty view changes only its query membership and retains separately loaded detail", async () => {
  const comment = { id: 1, taskId: cards[0].id, comment: "Loaded discussion" } as import("@/lib/types").TaskComment;
  const { planning } = ownerWithViews(async query => ({ ...viewRead(query), queryRevision: "empty-r2", data: emptyPlanningShellState }), {
    readTaskDetail: async () => ({ model: { revision: "detail", project: emptyPlanningShellState.project, item: { ...cards[0], note: "Full loaded detail" }, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [comment], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] } }),
  });
  await planning.loadTaskDetail(cards[0].id);
  await expect(planning.ensureBoardQuery({ view: "complete", filters: { query: "No matching Deliverable" } })).resolves.toBe(true);
  expect(planning.board().tasks).toEqual([]);
  expect(planning.taskDetail(cards[0].id)).toMatchObject({ task: { note: "Full loaded detail" }, comments: [comment] });
});

test("a delayed complete view preserves confirmed edits, pending edits and previously loaded detail", async () => {
  const read = deferred<PlanningWorkspaceRead>();
  const write = deferred<{ task: Partial<Task> }>();
  const { planning } = ownerWithViews(() => read.promise, {
    saveTask: async task => task.id === cards[1].id ? write.promise : { task: { ...task, title: "Confirmed after view read", updatedAt: "r2" } },
    readTaskDetail: async () => ({ model: { revision: "detail", project: emptyPlanningShellState.project, item: { ...cards[0], note: "Full loaded detail" }, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] } }),
  });
  await planning.loadTaskDetail(cards[0].id);
  const reading = planning.ensureBoardQuery({ view: "complete" });
  await planning.saveTask(cards[0], { title: "Confirmed after view read" });
  const saving = planning.saveTask(cards[1], { title: "Pending edit" });
  const summary = viewRead({ view: "complete" });
  read.resolve({ ...summary, taskOmittedFields: ["note"] });
  await reading;
  expect(planning.taskDetail(cards[0].id).task).toMatchObject({ title: "Confirmed after view read", note: "Full loaded detail", updatedAt: "r2" });
  expect(planning.taskDetail(cards[1].id)).toMatchObject({ task: { title: "Pending edit" }, saveStatus: "saving" });
  write.resolve({ task: { ...cards[1], title: "Pending edit", updatedAt: "r2" } });
  await saving;
  expect(planning.taskDetail(cards[1].id)).toMatchObject({ task: { title: "Pending edit" }, saveStatus: "saved" });
});

test("changed source coverage invalidates retained Board membership", async () => {
  const reads: PlanningBoardQueryInput[] = [];
  const { planning } = ownerWithViews(async query => {
    reads.push(query);
    const result = viewRead(query);
    return { ...result, queryRevision: "r2", board: result.board ? { ...result.board, revision: "r2" } : undefined };
  });
  await planning.ensureBoardQuery({ view: "complete" });
  await planning.ensureBoardQuery({ view: "board" });
  expect(reads).toHaveLength(2);
  expect(planning.board().result?.revision).toBe("r2");
});

test.each([null, "another-user"])("cached complete coverage and delayed reads end with the session (%s)", async replacement => {
  const pending = deferred<PlanningWorkspaceRead>();
  let delay = false;
  const owner = ownerWithViews(query => delay ? pending.promise : Promise.resolve(viewRead(query)));
  await owner.planning.ensureBoardQuery({ view: "complete" });
  delay = true;
  const reading = owner.planning.refreshWorkspace("planning");
  owner.internal.bindSession(replacement ? { ...session, userId: replacement, user: { id: replacement } } : null);
  pending.resolve(viewRead({ view: "complete", filters: { query: "late" } }));
  await expect(reading).resolves.toBe(false);
  await expect(owner.planning.ensureBoardQuery({ view: "complete" })).resolves.toBe(false);
  expect(owner.planning.board().tasks).toEqual([]);
  expect(owner.planning.board().result).toBeUndefined();
  expect(owner.planning.protectedCache()).toBeNull();
});

test("a replacement authority cannot reuse complete coverage or a retained Board", async () => {
  let denied = false;
  const owner = ownerWithViews(async query => {
    if (denied) throw Object.assign(new Error("Authority ended"), { status: 403 });
    return viewRead(query);
  });
  await owner.planning.ensureBoardQuery({ view: "complete" });
  denied = true;
  owner.internal.bindSession({ ...session, revision: "replacement-session" });
  await expect(owner.planning.ensureBoardQuery({ view: "board" })).resolves.toBe(false);
  await expect(owner.planning.ensureBoardQuery({ view: "complete" })).resolves.toBe(false);
  expect(owner.planning.board()).toMatchObject({ tasks: [], readStatus: "forbidden" });
  expect(owner.planning.protectedCache("planning")).toBeNull();
});

test.each(["tasks", "sprints", "taskRelations"] as const)("an incomplete %s read cannot become a complete alternative view", async field => {
  const { planning } = ownerWithViews(async query => {
    const result = viewRead(query);
    return { ...result, coverage: { ...result.coverage, [field]: "partial" } };
  });
  await expect(planning.ensureBoardQuery({ view: "complete" })).resolves.toBe(false);
  expect(planning.board().readStatus).toBe("unavailable");
  expect(planning.board().queryKey).toBe(planningBoardQueryKey({ view: "board" }));
  expect(planning.board().tasks).toHaveLength(20);
});
