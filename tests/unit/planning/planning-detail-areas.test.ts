import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
import type { Task } from "@/lib/types";

const task = { id: "canonical-detail", title: "Complete canonical target", updatedAt: "target-version", status: "Offen", taskType: "deliverable" } as Task;
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


test.each(["task-version", "source-version"] as const)("children without supporting hydration preserve accepted names when %s changes", async changed => {
  const full = { ...task, assigneeId: "assigned-profile", assignee: "Accepted assignee", ownerId: "owner-profile", owner: "Accepted owner", createdById: "creator-profile", createdBy: "Accepted creator", description: "Accepted canonical detail" };
  const compact = { ...task, assigneeId: full.assigneeId, ownerId: full.ownerId, createdById: full.createdById,
    updatedAt: changed === "task-version" ? "new-target-version" : task.updatedAt, detailAvailability: "summary" as const };
  const model: TaskDetailModel = { revision: target.revision, observedAt: target.observedAt, validUntil: target.validUntil, authorityDeadline: target.authorityDeadline,
    sourceRevision: changed === "source-version" ? "new-directory-source" : target.sourceRevision,
    readArea: "children", item: compact, ancestors: [], children: [], relatedItems: [], supportingData: "omitted",
    taskOmittedFields: ["description", "assignee", "owner", "createdBy"], coverage: { children: "complete" },
    childProgress: { completed: 0, total: 0, unfinished: 0, percentage: 0 },
    discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [],
  };
  const { planning } = createPlanningState({ userId: "user-a", initialData: { ...emptyPlanningShellState, tasks: [full] }, adapter: {
    readWorkspace: async () => null, saveTask: async () => ({ task: full }),
    readTaskDetail: async (_id, options) => ({ model: options?.area === "children" ? model : { ...target, item: full }, readAuthority: { userId: "user-a", deadline: target.authorityDeadline! } }),
  } });
  expect(await planning.loadTaskDetail(task.id, { area: "target" })).toMatchObject({ ok: true });
  expect(await planning.loadTaskDetail(task.id, { area: "children" })).toMatchObject({ ok: true });
  expect(planning.taskDetail(task.id).task).toMatchObject({ assignee: full.assignee, owner: full.owner, createdBy: full.createdBy, description: full.description, detailAvailability: "stale" });
  expect(planning.taskDetail(task.id)).toMatchObject({ childrenCoverage: "complete-empty", childProgress: { total: 0, completed: 0, unfinished: 0, percentage: 0 } });
});


test.each(["target", "children"] as const)("parallel area acceptance keeps both coverages when %s starts first and answers last", async first => {
  type Area = "target" | "children";
  const second: Area = first === "target" ? "children" : "target";
  const now = Date.now(), version = "2026-11-16T12:00:00.000Z", source = "unchanged-parallel-source";
  const full = { ...task, updatedAt: version, description: "Canonical complete target field", assigneeId: actor.id, assignee: "Canonical accepted name" };
  const summary = { id: full.id, title: full.title, status: full.status, taskType: full.taskType, updatedAt: version, detailAvailability: "summary" } as Task;
  const child = { id: "parallel-direct-child", title: "Complete direct membership", status: "Offen", taskType: "sub_issue", parentTaskId: full.id, updatedAt: version, detailAvailability: "summary" } as Task;
  const deadlines = { target: now + 45_000, children: now + 55_000 };
  const models: Record<Area, TaskDetailModel> = {
    target: { ...target, item: full, revision: version, sourceRevision: source, observedAt: new Date(now).toISOString(), validUntil: null,
      authorityDeadline: deadlines.target, readActor: { profileId: actor.id, platformRole: actor.platformRole } },
    children: { revision: version, sourceRevision: source, observedAt: new Date(now).toISOString(), validUntil: null,
      authorityDeadline: deadlines.children, readActor: { profileId: actor.id, platformRole: actor.platformRole },
      readArea: "children", supportingData: "omitted", item: summary, ancestors: [], children: [child], relatedItems: [],
      taskOmittedFields: ["description", "assignee", "owner", "createdBy"], coverage: { children: "complete" },
      childProgress: { completed: 0, total: 1, unfinished: 1, percentage: 0 },
      discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [],
    },
  };
  type Reply = { model: TaskDetailModel; readAuthority: { userId: string; deadline: number } };
  const replies = new Map<Area, (reply: Reply) => void>(), signals = new Map<Area, AbortSignal | undefined>();
  const ordinals: string[] = [];
  const record = (event: string) => ordinals.push(`${ordinals.length + 1}:${event}`);
  const { planning } = createPlanningState({ userId: "user-a", initialSession: session, initialCurrentProfile: actor,
    initialData: { ...emptyPlanningShellState, tasks: [summary] }, adapter: {
      now: () => now, readWorkspace: async () => null, saveTask: async () => ({ task: full }),
      readTaskDetail: async (_id, options) => {
        if (options?.area !== "target" && options?.area !== "children") throw new Error("Explicit independent area required");
        const area = options.area;
        record(`start:${area}`); signals.set(area, options.signal);
        return new Promise<Reply>(resolve => { replies.set(area, resolve); });
      },
    },
  });
  const consumer = new AbortController();
  const pending = new Map<Area, ReturnType<typeof planning.loadTaskDetail>>();
  pending.set(first, planning.loadTaskDetail(full.id, { area: first, signal: consumer.signal }));
  pending.set(second, planning.loadTaskDetail(full.id, { area: second, signal: consumer.signal }));
  const answer = async (area: Area) => {
    record(`answer:${area}`);
    replies.get(area)!({ model: models[area], readAuthority: { userId: "user-a", deadline: deadlines[area] } });
    expect(await pending.get(area)).toMatchObject({ ok: true });
  };
  await answer(second);
  if (second === "children") {
    expect(planning.taskDetail(full.id).task).toMatchObject({ detailAvailability: "summary" });
    expect(planning.taskDetail(full.id).task?.description).toBeUndefined();
    expect(planning.taskDetail(full.id).task?.assignee).toBeUndefined();
    expect(planning.taskDetail(full.id).readStatus).toBe("loading");
  } else {
    expect(planning.taskDetail(full.id)).toMatchObject({ readStatus: "current", task: { description: full.description, assignee: full.assignee } });
  }
  expect(signals.get("target")?.aborted).toBe(false);
  await answer(first);
  expect(ordinals).toEqual([`1:start:${first}`, `2:start:${second}`, `3:answer:${second}`, `4:answer:${first}`]);
  expect(ordinals.filter(event => event.endsWith("start:target"))).toHaveLength(1);
  expect(signals.get("target")?.aborted).toBe(false);
  expect(planning.taskDetail(full.id)).toMatchObject({ readStatus: "current", task: { updatedAt: version, description: full.description, assignee: full.assignee },
    childrenCoverage: "complete", children: [{ id: child.id, parentTaskId: full.id }],
    childProgress: { completed: 0, total: 1, unfinished: 1, percentage: 0 } });
});
