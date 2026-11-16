import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
import type { Task } from "@/lib/types";

const parent = taskDetailStoryTask({ id: "old-parent", updatedAt: "parent-r1" });
const other = taskDetailStoryTask({ id: "new-parent", updatedAt: "other-r1" });
const child = taskDetailStoryTask({ id: "direct-child", taskType: "sub_issue", parentTaskId: parent.id, status: "Offen", updatedAt: "child-r1" });
function receipt(item: Task, children: Task[], now = Date.now()) {
  const model: TaskDetailModel = { revision: item.updatedAt!, sourceRevision: "children-source", readArea: "children", observedAt: new Date(now).toISOString(), validUntil: null, authorityDeadline: now + 10_000,
    project: emptyPlanningShellState.project, item, ancestors: [], children, relatedItems: [], people: [], sprints: [], coverage: { children: "complete" },
    childProgress: { completed: 0, total: children.length, unfinished: children.length, percentage: 0 },
    discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] };
  return { model, readAuthority: { userId: "user", deadline: model.authorityDeadline! } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test.each(["reparent", "complete"] as const)("a confirmed child %s invalidates affected progress and a late old list cannot undo it", async change => {
  const late = deferred<ReturnType<typeof receipt>>(); let delayed = false;
  const patch = change === "reparent" ? { parentTaskId: other.id } : { status: "Erledigt" as const };
  const { planning } = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [parent, other, child] }, adapter: {
    readWorkspace: async () => null, saveTask: async () => ({ task: { ...child, ...patch, updatedAt: "child-r2" } }),
    readTaskDetail: async id => delayed ? late.promise : receipt(id === parent.id ? parent : other, id === parent.id ? [child] : []),
  } });
  await planning.loadTaskDetail(parent.id, { area: "children" }); await planning.loadTaskDetail(other.id, { area: "children" });
  delayed = true;
  const reading = planning.loadTaskDetail(parent.id, { area: "children", refresh: true });
  expect(await planning.saveTask(child, patch)).toMatchObject({ ok: true });
  if (change === "reparent") expect(planning.taskDetail(other.id)).toMatchObject({ childrenCoverage: "stale", childProgress: null });
  late.resolve(receipt(parent, [child])); await reading;
  expect(planning.taskDetail(child.id).task).toMatchObject({ ...patch, updatedAt: "child-r2" });
  expect(planning.taskDetail(parent.id)).toMatchObject({ childrenCoverage: "stale", childProgress: null });
  if (change === "reparent") {
    expect(planning.taskDetail(parent.id).children).toEqual([]);
    expect(planning.taskDetail(other.id).children.map(item => item.id)).toEqual([child.id]);
  }
});

test("shared child demand survives one release and its accepted child identities expire with original authority", async () => {
  let now = 1_000, reads = 0; const pending = deferred<ReturnType<typeof receipt>>(); let signal: AbortSignal | undefined;
  const { planning } = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [parent] }, adapter: {
    now: () => now, readWorkspace: async () => null, saveTask: async () => ({ task: child }),
    readTaskDetail: async (_id, options) => { reads++; signal = options?.signal; return pending.promise; },
  } });
  const first = new AbortController(), second = new AbortController();
  const one = planning.loadTaskDetail(parent.id, { area: "children", signal: first.signal });
  const two = planning.loadTaskDetail(parent.id, { area: "children", signal: second.signal });
  expect(reads).toBe(1); first.abort(); expect(signal?.aborted).toBe(false);
  pending.resolve(receipt(parent, [child], now));
  expect(await one).toMatchObject({ ok: false }); expect(await two).toMatchObject({ ok: true });
  expect(planning.taskDetail(parent.id).childrenCoverage).toBe("complete");
  now = 11_001;
  expect(planning.taskDetail(parent.id)).toMatchObject({ children: [], childrenCoverage: "stale", childProgress: null });
  expect(planning.taskDetail(child.id).task).toBeNull();
});

test("releasing the last child consumer aborts transport and rejects late membership without a perpetual loading state", async () => {
  const pending = deferred<ReturnType<typeof receipt>>(); let signal: AbortSignal | undefined;
  const { planning } = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [parent] }, adapter: {
    readWorkspace: async () => null, saveTask: async () => ({ task: child }),
    readTaskDetail: async (_id, options) => { signal = options?.signal; return pending.promise; },
  } });
  const controller = new AbortController();
  const reading = planning.loadTaskDetail(parent.id, { area: "children", signal: controller.signal });
  controller.abort(); expect(signal?.aborted).toBe(true);
  pending.resolve(receipt(parent, [child])); expect(await reading).toMatchObject({ ok: false });
  expect(planning.taskDetail(parent.id)).toMatchObject({ children: [], childrenCoverage: "not-loaded", childProgress: null });
  expect(planning.taskDetail(child.id).task).toBeNull();
});
