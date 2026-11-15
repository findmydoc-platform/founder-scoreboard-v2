import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
import type { Task } from "@/lib/types";

const task = { id: "canonical-detail", title: "Complete canonical target", updatedAt: "target-version", taskType: "deliverable" } as Task;
const target: TaskDetailModel = {
  revision: "target-version", sourceRevision: "target-source", readArea: "target", observedAt: "2026-11-15T12:00:00Z", validUntil: null, authorityDeadline: Date.now() + 60_000,
  project: emptyPlanningShellState.project, item: task, ancestors: [], children: [], relatedItems: [], people: [], sprints: [],
  coverage: {}, discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [],
};

test("target readiness neither completes unrequested children nor invents discussion or timeline coverage", async () => {
  const { planning } = createPlanningState({ userId: "user-a", initialData: emptyPlanningShellState,
    adapter: { readWorkspace: async () => null, saveTask: async () => ({ task }), readTaskDetail: async () => ({ model: target, readAuthority: { userId: "user-a", deadline: Date.now() + 60_000 } }) },
  });
  const result = await Reflect.apply(planning.loadTaskDetail, planning, [task.id, { area: "target" }]);
  expect(result.ok).toBe(true);
  expect(planning.taskDetail(task.id).task).toMatchObject({ id: task.id, title: task.title });
  expect(planning.taskDetail(task.id).childrenReadStatus).toBe("not-loaded");
  expect(planning.taskDetail(task.id)).toMatchObject({ readStatus: "current", areaReadStatus: { discussion: "not-loaded", timeline: "not-loaded" } });
});

test("equivalent detail consumers abort shared work only after the last release and reject its late success", async () => {
  let resolve!: (value: { model: TaskDetailModel; readAuthority: { userId: string; deadline: number } }) => void;
  const pending = new Promise<{ model: TaskDetailModel; readAuthority: { userId: string; deadline: number } }>(done => { resolve = done; });
  let reads = 0;
  let transportSignal: AbortSignal | undefined;
  const { planning } = createPlanningState({ userId: "user-a", initialData: emptyPlanningShellState, adapter: {
    readWorkspace: async () => null, saveTask: async () => ({ task }),
    readTaskDetail: async (_id, options) => { reads++; transportSignal = options?.signal; return pending; },
  } });
  const first = new AbortController(), second = new AbortController();
  const firstOptions = { area: "target" as const, signal: first.signal };
  const secondOptions = { area: "target" as const, signal: second.signal };
  const one = planning.loadTaskDetail(task.id, firstOptions);
  const two = planning.loadTaskDetail(task.id, secondOptions);
  expect(reads).toBe(1);
  first.abort();
  expect(transportSignal?.aborted).toBe(false);
  second.abort();
  expect(transportSignal?.aborted).toBe(true);
  resolve({ model: target, readAuthority: { userId: "user-a", deadline: Date.now() + 60_000 } });
  expect(await one).toMatchObject({ ok: false });
  expect(await two).toMatchObject({ ok: false });
  expect(planning.taskDetail(task.id).task).toBeNull();
});
