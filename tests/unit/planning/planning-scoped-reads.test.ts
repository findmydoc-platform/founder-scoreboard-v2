import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
import type { Task, TaskComment } from "@/lib/types";

const task = { id: "task-a", title: "Board task", updatedAt: "opaque-before", taskType: "deliverable" } as Task;
const comment: TaskComment = { id: 1, taskId: task.id, profileId: "profile-a", comment: "Loaded discussion", githubDeliveryStatus: "not_applicable", githubCommentUrl: "", createdAt: "2026-10-28T00:00:00Z" };
const initial = { ...emptyPlanningShellState, tasks: [task] };
function detail(item = task): TaskDetailModel {
  return { revision: "detail-opaque", project: initial.project, item, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [comment], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("Board refresh preserves loaded detail collections outside its declared coverage", async () => {
  const { planning } = createPlanningState({ userId: "user-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readTaskDetail: async () => ({ model: detail() }),
    readWorkspace: async () => ({ data: { ...initial, tasks: [{ ...task, title: "Refreshed Board task" }] } }),
  } });
  await planning.loadTaskDetail(task.id);
  await planning.refreshWorkspace("planning");
  expect(planning.taskDetail(task.id)).toMatchObject({ task: { title: "Refreshed Board task" }, comments: [comment], readStatus: "current" });
});

test("complete empty queries change only their membership while detail identities and other memberships survive", async () => {
  const other = { ...task, id: "task-b", title: "Team only" };
  const { planning } = createPlanningState({ userId: "user-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readTaskDetail: async () => ({ model: detail() }),
    readWorkspace: async workspace => ({ data: { ...initial, tasks: workspace === "team" ? [other] : [] }, taskCoverage: workspace === "planning" ? "complete" : "partial" }),
  } });
  await planning.loadTaskDetail(task.id);
  await planning.refreshWorkspace("team");
  await planning.refreshWorkspace("planning");
  expect(planning.board().tasks).toEqual([]);
  expect(planning.workspace("team")).toMatchObject({ tasks: [other], readStatus: "current", completeness: "partial" });
  expect(planning.taskDetail(task.id).task?.title).toBe("Board task");
  expect(planning.taskDetail(task.id).comments).toEqual([comment]);
  expect(planning.protectedCache("planning")?.tasks).toEqual([]);
  expect(planning.protectedCache("team")?.tasks).toEqual([other]);
});

test("degraded detail reads retain discussion and do not replace newer related task identities", async () => {
  const other = { ...task, id: "task-b", title: "Related before" };
  const old = deferred<{ model: TaskDetailModel; unavailable: ["discussion"] }>();
  let reads = 0;
  const { planning } = createPlanningState({ userId: "user-a", initialData: { ...initial, tasks: [task, other] }, adapter: {
    saveTask: async () => ({ task }),
    readTaskDetail: async () => ++reads === 1 ? { model: detail() } : old.promise,
    readWorkspace: async () => ({ data: { ...initial, tasks: [{ ...other, title: "Related accepted", updatedAt: "new-opaque" }] } }),
  } });
  await planning.loadTaskDetail(task.id);
  const delayed = planning.loadTaskDetail(task.id);
  expect(planning.taskDetail(task.id).readStatus).toBe("loading");
  await planning.refreshWorkspace("team");
  old.resolve({ model: { ...detail(), discussion: { comments: [], externalComments: [] }, relatedItems: [other] }, unavailable: ["discussion"] });
  await delayed;
  expect(planning.taskDetail(task.id)).toMatchObject({ comments: [comment], readStatus: "unavailable", unavailable: ["discussion"] });
  expect(planning.taskDetail(other.id).task).toMatchObject({ title: "Related accepted", updatedAt: "new-opaque" });
});

test("unloaded, loading, temporarily unavailable and forbidden scopes remain distinct without invented empty data", async () => {
  let failure = 503;
  const pending = deferred<null>();
  const { planning } = createPlanningState({ userId: "user-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async workspace => {
      if (workspace === "events") return pending.promise;
      throw Object.assign(new Error("Read failed"), { status: failure });
    }, readTaskDetail: async () => { throw Object.assign(new Error("Detail forbidden"), { status: 403 }); },
  } });
  expect(planning.workspace("events").readStatus).toBe("not-loaded");
  const loading = planning.refreshWorkspace("events");
  expect(planning.workspace("events").readStatus).toBe("loading");
  pending.resolve(null);
  await expect(loading).resolves.toBe(false);
  expect(planning.workspace("events").readStatus).toBe("unavailable");
  await planning.refreshWorkspace("planning");
  expect(planning.workspace("planning")).toMatchObject({ readStatus: "unavailable", tasks: [task] });
  failure = 403;
  await planning.refreshWorkspace("planning");
  expect(planning.workspace("planning")).toMatchObject({ readStatus: "forbidden", tasks: [] });
  await expect(planning.loadTaskDetail(task.id)).resolves.toMatchObject({ ok: false });
  expect(planning.taskDetail(task.id)).toMatchObject({ task: null, readStatus: "forbidden", comments: [] });
});

test("expired session authority cannot be extended by reading a scoped cache or a late workspace result", async () => {
  let now = 1_000;
  const pending = deferred<{ data: typeof initial }>();
  const { planning } = createPlanningState({ userId: "user-a", initialData: initial,
    initialSession: { userId: "user-a", revision: "session-a", expiresAt: 2, user: { id: "user-a" } },
    adapter: { now: () => now, saveTask: async () => ({ task }), readWorkspace: () => pending.promise },
  });
  const reading = planning.refreshWorkspace("planning");
  expect(planning.protectedCache("planning")?.tasks).toEqual([task]);
  now = 2_001;
  expect(planning.protectedCache("planning")).toBeNull();
  pending.resolve({ data: initial });
  await expect(reading).resolves.toBe(false);
  expect(planning.board().tasks).toEqual([]);
});

test("partial detail collections and capped Board relationships do not erase separately loaded records", async () => {
  let reads = 0;
  const relation = { id: "relation-a", taskId: task.id, relatedTaskId: "task-b" } as unknown as import("@/lib/types").TaskRelation;
  const { planning } = createPlanningState({ userId: "user-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }),
    readTaskDetail: async () => ({ model: ++reads === 1 ? { ...detail(), relationships: [relation] } : { ...detail(), discussion: { comments: [], externalComments: [] } } }),
    readWorkspace: async () => ({ data: initial }),
  } });
  await planning.loadTaskDetail(task.id);
  await planning.loadTaskDetail(task.id);
  await planning.refreshWorkspace("planning");
  expect(planning.taskDetail(task.id).comments).toEqual([comment]);
  expect(planning.taskDetail(task.id).relationships).toEqual([relation]);
});

test("a delayed complete empty Board cannot remove a task confirmed after the query began", async () => {
  const read = deferred<{ data: typeof initial; taskCoverage: "complete" }>();
  const { planning } = createPlanningState({ userId: "user-a", initialData: initial, adapter: {
    saveTask: async () => ({ task: { ...task, title: "Confirmed while reading", updatedAt: "opaque-after" } }),
    readWorkspace: () => read.promise,
  } });
  const reading = planning.refreshWorkspace("planning");
  await planning.saveTask(task, { title: "Confirmed while reading" });
  read.resolve({ data: { ...initial, tasks: [] }, taskCoverage: "complete" });
  await reading;
  expect(planning.workspace("planning")).toMatchObject({ tasks: [{ title: "Confirmed while reading" }], readStatus: "stale" });
  expect(planning.protectedCache("planning")?.tasks[0].updatedAt).toBe("opaque-after");
});

test("an unloaded workspace has no confirmed cache and a complete empty detail area clears only its selected task", async () => {
  const otherComment = { ...comment, id: 2, taskId: "task-b" };
  const { planning } = createPlanningState({ userId: "user-a", initialData: { ...initial, taskComments: [comment, otherComment] }, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => null,
    readTaskDetail: async () => ({ model: { ...detail(), coverage: { discussion: "complete" }, discussion: { comments: [], externalComments: [] } } }),
  } });
  expect(planning.protectedCache("team")).toBeNull();
  await planning.loadTaskDetail(task.id);
  expect(planning.taskDetail(task.id).comments).toEqual([]);
  expect(planning.taskDetail("task-b").comments).toEqual([otherComment]);
});

test("a newer scoped read protects common identity from an older detail response and reports that detail stale", async () => {
  const response = deferred<{ model: TaskDetailModel }>();
  const { planning } = createPlanningState({ userId: "user-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readTaskDetail: () => response.promise,
    readWorkspace: async () => ({ data: { ...initial, tasks: [{ ...task, title: "New task", updatedAt: "opaque-new" }] } }),
  } });
  const loading = planning.loadTaskDetail(task.id);
  await planning.refreshWorkspace("team");
  response.resolve({ model: detail() });
  await loading;
  expect(planning.taskDetail(task.id)).toMatchObject({ task: { title: "New task", updatedAt: "opaque-new" }, readStatus: "stale" });
});


test("direct child lists become complete only after their own shared detail read and retain exact membership", async () => {
  const firstChild = { ...task, id: "child-a", taskType: "sub_issue" as const, parentTaskId: task.id };
  const otherChild = { ...firstChild, id: "child-b" };
  let children = [firstChild, otherChild];
  const { planning } = createPlanningState({ userId: "user-a", initialData: { ...initial, tasks: [task, firstChild] }, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => null, readTaskDetail: async () => ({ model: { ...detail(), children } }),
  } });
  expect(planning.taskDetail(task.id)).toMatchObject({ children: [], childrenReadStatus: "not-loaded" });
  await planning.loadTaskDetail(task.id);
  expect(planning.taskDetail(task.id)).toMatchObject({ children: [firstChild, otherChild], childrenReadStatus: "current" });
  children = [otherChild];
  await planning.loadTaskDetail(task.id);
  expect(planning.taskDetail(task.id)).toMatchObject({ children: [otherChild], childrenReadStatus: "current" });
  expect(planning.taskDetail(firstChild.id).task).toMatchObject({ id: firstChild.id });
});


test("simultaneous child and panel reads share one detail response and an ended session discards its child list", async () => {
  const response = deferred<{ model: TaskDetailModel }>();
  let reads = 0;
  let sessionChanged!: (userId: string | null) => void;
  const { planning } = createPlanningState({ userId: "user-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => null,
    readTaskDetail: () => { reads++; return response.promise; },
    subscribeSession: listener => { sessionChanged = listener; return () => {}; },
  } });
  const first = planning.loadTaskDetail(task.id);
  const joined = planning.loadTaskDetail(task.id);
  expect(first).toBe(joined);
  expect(reads).toBe(1);
  expect(planning.taskDetail(task.id).childrenReadStatus).toBe("loading");
  sessionChanged(null);
  response.resolve({ model: { ...detail(), children: [{ ...task, id: "late-child", parentTaskId: task.id }] } });
  await expect(first).resolves.toEqual({ ok: false });
  expect(planning.taskDetail(task.id)).toMatchObject({ task: null, children: [], childrenReadStatus: "not-loaded" });
});

test("late child detail preserves a confirmed child edit and marks its list stale", async () => {
  const child = { ...task, id: "child-a", title: "Before", taskType: "sub_issue" as const, parentTaskId: task.id };
  const response = deferred<{ model: TaskDetailModel }>();
  const { planning } = createPlanningState({ userId: "user-a", initialData: { ...initial, tasks: [task, child] }, adapter: {
    saveTask: async () => ({ task: { ...child, title: "Confirmed child", updatedAt: "after" } }),
    readWorkspace: async () => null, readTaskDetail: () => response.promise,
  } });
  const loading = planning.loadTaskDetail(task.id);
  await planning.saveTask(child, { title: "Confirmed child" });
  response.resolve({ model: { ...detail(), children: [child] } });
  await loading;
  expect(planning.taskDetail(task.id)).toMatchObject({ children: [{ id: child.id, title: "Confirmed child", updatedAt: "after" }], childrenReadStatus: "stale" });
});


test("a later parent summary retains a loaded child list and marks it stale for re-expansion", async () => {
  const child = { ...task, id: "child-a", taskType: "sub_issue" as const, parentTaskId: task.id, description: "Full child content" };
  const { planning } = createPlanningState({ userId: "user-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readTaskDetail: async () => ({ model: { ...detail(), children: [child] } }),
    readWorkspace: async () => ({ data: { ...initial, tasks: [{ ...task, detailAvailability: "summary" }] }, taskCoverage: "partial", coverage: { tasks: "partial" } }),
  } });
  await planning.loadTaskDetail(task.id);
  await planning.refreshWorkspace("planning");
  expect(planning.taskDetail(task.id)).toMatchObject({ children: [child], childrenReadStatus: "stale" });
});
