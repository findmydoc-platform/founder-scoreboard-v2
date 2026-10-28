import { expect, test } from "vitest";
import { createPlanningState, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { Task } from "@/lib/types";
const task = { id: "backlog-task", title: "Original", updatedAt: "r1", sprintId: "", strategy: { goal: "Keep goal", successCriteria: "Success", scopeConstraints: "Scope" }, raciAssignments: [{ profileId: "p", role: "accountable", sortOrder: 1 }], evidenceLinks: ["https://evidence.example.test/"], note: "Known detail" } as unknown as Task;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
test("Backlog projects the common confirmed task and protects its revision against an older read", async () => {
 const old = deferred<PlanningWorkspaceRead>();
 const { planning } = createPlanningState({ userId: "backlog-user", initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, tasks: [task] }, adapter: { readWorkspace: () => old.promise, saveTask: async () => ({ task: { id: task.id, title: "Confirmed", updatedAt: "r2" } }) } });
 const reading = planning.refreshWorkspace("backlog"); await planning.saveTask(task, { title: "Confirmed" });
 old.resolve({ data: { ...emptyPlanningShellState, tasks: [task] }, coverage: { tasks: "partial" }, taskCoverage: "partial" }); await reading;
 expect(planning.backlog().model.items[0].title).toBe("Confirmed"); expect(planning.taskDetail(task.id).task?.title).toBe("Confirmed");
});

test("partial Backlog auxiliaries preserve known fields and complete empty membership affects only Backlog", async () => {
 let complete = false;
 const { planning } = createPlanningState({ userId: "backlog-user", initialWorkspace: "planning", initialData: { ...emptyPlanningShellState, tasks: [task] }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: { ...emptyPlanningShellState, tasks: complete ? [] : [{ ...task, title: "Fresh title", strategy: undefined, raciAssignments: [], evidenceLinks: [] }] }, coverage: { tasks: complete ? "complete" : "partial" }, taskCoverage: complete ? "complete" : "partial", taskOmittedFields: ["strategy", "raciAssignments", "evidenceLinks"] }) } });
 await planning.refreshWorkspace("backlog"); expect(planning.backlog().model.items[0]).toMatchObject({ title: "Fresh title", strategy: task.strategy, raciAssignments: task.raciAssignments, evidenceLinks: task.evidenceLinks });
 complete = true; await planning.refreshWorkspace("backlog"); expect(planning.backlog().model.items).toEqual([]); expect(planning.board().tasks[0].id).toBe(task.id); expect(planning.taskDetail(task.id).task?.note).toBe("Known detail");
});
