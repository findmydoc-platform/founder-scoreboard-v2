import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
import type { Task } from "@/lib/types";

const task = { id: "canonical-detail", title: "Complete canonical target", updatedAt: "target-version", taskType: "deliverable" } as Task;
const target: TaskDetailModel = {
  revision: task.updatedAt, sourceRevision: "target-source", readArea: "target", observedAt: "2026-11-15T12:00:00Z", validUntil: null,
  project: emptyPlanningShellState.project, item: task, ancestors: [], children: [], relatedItems: [], people: [], sprints: [],
  coverage: {}, discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [],
};

test("target readiness neither completes unrequested children nor invents discussion or timeline coverage", async () => {
  const { planning } = createPlanningState({ userId: "user-a", initialData: emptyPlanningShellState,
    adapter: { saveTask: async () => ({ task }), readTaskDetail: async () => ({ model: target, readAuthority: { userId: "user-a", deadline: Date.now() + 60_000 } }) },
  });
  const result = await Reflect.apply(planning.loadTaskDetail, planning, [task.id, { area: "target" }]);
  expect(result.ok).toBe(true);
  expect(planning.taskDetail(task.id).task).toMatchObject({ id: task.id, title: task.title });
  expect(planning.taskDetail(task.id).childrenReadStatus).toBe("not-loaded");
  expect(planning.taskDetail(task.id)).toMatchObject({ readStatus: "current", areaReadStatus: { discussion: "not-loaded", timeline: "not-loaded" } });
});
