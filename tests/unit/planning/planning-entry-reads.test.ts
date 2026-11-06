import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
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
  const read = planningWorkspaceHydration("planning", { revision: "r1", project: data.project, items: [task], people: [], sprints: [], relationships: [], preferences: [], coverage: { items: coverage } }, session);
  const { planning } = createPlanningState({ userId: session.userId, initialData: data, initialSession: session, initialWorkspaceRead: read,
    adapter: { saveTask: async () => ({ task }), readWorkspace: async () => null },
  });
  expect(planning.workspace("planning")).toMatchObject({ tasks: [task], readStatus: "current", completeness: coverage });
});
