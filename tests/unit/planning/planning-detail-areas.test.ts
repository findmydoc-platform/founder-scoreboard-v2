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

const actor = { id: "detail-actor", name: "Synthetic actor", platformRole: "founder" as const, githubLogin: "" };
const session = { userId: "user-a", user: { id: "user-a" }, revision: "detail-session", expiresAt: Math.floor(Date.now()/1000) + 3600 };

test.each(["missing-deadline", "foreign-session", "foreign-target", "foreign-actor"] as const)("an initial %s receipt cannot establish current canonical detail", kind => {
  const model = { ...target, authorityDeadline: kind === "missing-deadline" ? undefined : Date.now() + 60_000,
    readActor: { profileId: kind === "foreign-actor" ? "other-actor" : actor.id, platformRole: actor.platformRole } };
  const read = { itemId: kind === "foreign-target" ? "other-target" : task.id, model,
    readAuthority: { userId: "user-a", deadline: Date.now()+60_000 },
    session: { ...session, revision: kind === "foreign-session" ? "other-session" : session.revision } };
  const { planning } = createPlanningState({ userId: "user-a", initialSession: session, initialCurrentProfile: actor,
    initialData: { ...emptyPlanningShellState, tasks: [task] }, initialTaskDetailRead: read,
    adapter: { readWorkspace: async () => null, saveTask: async () => ({ task }) },
  });
  expect(planning.taskDetail(task.id).task).toBeNull();
  expect(planning.taskDetail(task.id).readStatus).not.toBe("current");
});

test("an accepted detail retains its original deadline and clears protected fields when that deadline expires", async () => {
  let now = 1_000;
  const model = { ...target, observedAt: new Date(now).toISOString(), authorityDeadline: 2_000,
    readActor: { profileId: actor.id, platformRole: actor.platformRole } };
  const { planning } = createPlanningState({ userId: "user-a", initialData: emptyPlanningShellState, initialCurrentProfile: actor,
    initialSession: { ...session, expiresAt: 10 },
    adapter: { now: () => now, readWorkspace: async () => null, saveTask: async () => ({ task }),
      readTaskDetail: async () => ({ model, readAuthority: { userId: "user-a", deadline: 2_000 } }) },
  });
  expect(await planning.loadTaskDetail(task.id, { area: "target" })).toMatchObject({ ok: true });
  expect(planning.taskDetail(task.id).task?.title).toBe("Complete canonical target");
  expect(planning.taskDetail(task.id).task?.id).toBe(task.id);
  now = 2_001;
  expect(planning.taskDetail(task.id).task).toBeNull();
  expect(planning.taskDetail(task.id).readStatus).not.toBe("current");
});


test("visible direct children become usable independently without completing target or secondary detail", async () => {
  const child = { ...task, id: "direct-child", title: "Open direct child", taskType: "sub_issue" as const, parentTaskId: task.id };
  const model: TaskDetailModel = { ...target, readArea: "children", children: [child] };
  const { planning } = createPlanningState({ userId: "user-a", initialData: { ...emptyPlanningShellState, tasks: [task] },
    adapter: { readWorkspace: async () => null, saveTask: async () => ({ task }),
      readTaskDetail: async (_id, options) => {
        if (options?.area !== "children") throw new Error("Independent child demand required");
        return { model, readAuthority: { userId: "user-a", deadline: model.authorityDeadline! } };
      } },
  });
  const result = await planning.loadTaskDetail(task.id, { area: "children" });
  expect(result).toMatchObject({ ok: true });
  expect(planning.taskDetail(task.id)).toMatchObject({ children: [child], childrenReadStatus: "current", readStatus: "not-loaded",
    areaReadStatus: { discussion: "not-loaded", timeline: "not-loaded" } });
  expect(planning.taskDetail(child.id).task).toMatchObject({ id: child.id, title: "Open direct child" });
});

test("compact child refresh retains full target and child draft content without certifying omitted fields", async () => {
  const child = { ...task, id: "retained-child", taskType: "sub_issue" as const, parentTaskId: task.id, description: "Retained child evidence", updatedAt: "child-before" };
  const fullTarget = { ...task, description: "Complete editable target" };
  const childSummary = { id: child.id, title: "New child title", taskType: child.taskType, parentTaskId: task.id, updatedAt: "child-after", detailAvailability: "summary" } as Task;
  let saves = 0;
  const { planning } = createPlanningState({ userId: "user-a", initialData: { ...emptyPlanningShellState, tasks: [fullTarget, child] }, adapter: {
    readWorkspace: async () => null, saveTask: async () => { saves++; return { task: child }; },
    readTaskDetail: async (_id, options) => ({ model: options?.area === "children"
      ? { ...target, item: { ...task, detailAvailability: "summary" }, readArea: "children", children: [childSummary], taskOmittedFields: ["description"], coverage: { children: "complete" } }
      : { ...target, item: fullTarget }, readAuthority: { userId: "user-a", deadline: target.authorityDeadline! } }),
  } });
  await planning.loadTaskDetail(task.id, { area: "target" });
  const editor = planning.beginTaskEdit(child.id);
  await planning.loadTaskDetail(task.id, { area: "children" });
  expect(planning.taskDetail(task.id)).toMatchObject({ readStatus: "current", task: { description: "Complete editable target" } });
  expect(planning.taskDetail(child.id).task).toMatchObject({ title: "New child title", description: "Retained child evidence", detailAvailability: "stale" });
  expect(await editor.save({ description: "Unsaved child draft" })).toMatchObject({ ok: false, kind: "versionConflict" });
  expect(saves).toBe(0);
});

test("child coverage distinguishes partial, complete-empty and failed refresh while progress and identity remain separate", async () => {
  const child = { ...task, id: "covered-child", taskType: "sub_issue" as const, parentTaskId: task.id };
  let coverage: "complete" | "partial" = "partial", children = [child], fail = false, reads = 0;
  const { planning } = createPlanningState({ userId: "user-a", initialData: { ...emptyPlanningShellState, tasks: [task] }, adapter: {
    readWorkspace: async () => null, saveTask: async () => ({ task }),
    readTaskDetail: async () => {
      reads++;
      if (fail) throw Object.assign(new Error("Child list unavailable"), { status: 503 });
      return { model: { ...target, readArea: "children", children, coverage: { children: coverage },
        ...(coverage === "complete" ? { childProgress: { completed: 0, total: children.length, unfinished: children.length, percentage: 0 } } : {}) } as TaskDetailModel,
        readAuthority: { userId: "user-a", deadline: target.authorityDeadline! } };
    },
  } });
  expect(planning.taskDetail(task.id)).toMatchObject({ childrenCoverage: "not-loaded", childProgress: null });
  await planning.loadTaskDetail(task.id, { area: "children" });
  expect(planning.taskDetail(task.id)).toMatchObject({ children: [child], childrenCoverage: "partial", childProgress: null });
  coverage = "complete";
  await planning.loadTaskDetail(task.id, { area: "children" });
  expect(planning.taskDetail(task.id)).toMatchObject({ childrenCoverage: "complete", childProgress: { total: 1, unfinished: 1 } });
  await planning.loadTaskDetail(task.id, { area: "children" });
  expect(reads).toBe(2);
  fail = true;
  await Reflect.apply(planning.loadTaskDetail, planning, [task.id, { area: "children", refresh: true }]);
  expect(planning.taskDetail(task.id)).toMatchObject({ children: [child], childrenCoverage: "failed", childProgress: null });
  fail = false; children = [];
  await planning.loadTaskDetail(task.id, { area: "children" });
  expect(planning.taskDetail(task.id)).toMatchObject({ children: [], childrenCoverage: "complete-empty", childProgress: { total: 0, unfinished: 0 } });
  expect(planning.taskDetail(child.id).task?.id).toBe(child.id);
});
