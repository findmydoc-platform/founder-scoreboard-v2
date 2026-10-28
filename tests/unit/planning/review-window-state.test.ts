import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
const open = { id: "open", name: "Sprint shown", status: "planning" as const, startDate: "2026-10-01", endDate: "2026-10-14", reviewDueAt: "old-deadline", scoreLocked: false, updatedAt: "opaque/shown" };
const locked = { ...open, id: "locked", scoreLocked: true, reviewDueAt: "locked-deadline" };
const omitted = { ...open, id: "omitted", reviewDueAt: "omitted-deadline" };
const task = taskDetailStoryTask({ id: "task", updatedAt: "task/shown" });
const initial = { ...emptyPlanningShellState, project: { ...emptyPlanningShellState.project, reviewObjectionWindowHours: 48 }, sprints: [open, locked, omitted], tasks: [task] };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("Review-window confirmation applies only its returned deadlines and rejects older reads without inventing Sprint revisions", async () => {
  const write = deferred<{ project: { id: string; reviewObjectionWindowHours: number }; sprints: { id: string; reviewDueAt: string }[] }>();
  const old = deferred<{ data: typeof initial }>();
  const after = deferred<{ data: typeof initial }>();
  let reads = 0;
  const owner = createPlanningState({ userId: "user", initialWorkspace: "sprint", initialData: initial, adapter: {
    saveTask: async (_, patch) => ({ task: { ...patch, updatedAt: "task/new" } }), saveReviewWindow: () => write.promise,
    readWorkspace: () => ++reads === 1 ? old.promise : after.promise,
  } });
  const prior = owner.planning.refreshWorkspace("sprint");
  const editor = owner.planning.beginReviewWindowEdit(48);
  const saved = editor.save(72);
  expect(owner.planning.reviewWindow().hours).toBe(72);
  expect(owner.planning.sprintWorkspace().model.sprints[0].reviewDueAt).toBe("old-deadline");
  await owner.planning.saveTask(task, { title: "Independent task" });
  write.resolve({ project: { id: initial.project.id, reviewObjectionWindowHours: 72 }, sprints: [{ id: open.id, reviewDueAt: "confirmed-deadline" }] });
  await expect(saved).resolves.toMatchObject({ ok: true });
  old.resolve({ data: initial }); await prior;
  expect(owner.planning.reviewWindow().hours).toBe(72);
  expect(owner.planning.sprintWorkspace().model.sprints).toMatchObject([{ id: "open", reviewDueAt: "confirmed-deadline", updatedAt: undefined }, { id: "locked", reviewDueAt: "locked-deadline" }, { id: "omitted", reviewDueAt: "omitted-deadline" }]);
  expect(owner.planning.taskDetail(task.id).task?.title).toBe("Independent task");
  expect(owner.planning.protectedCache()?.sprints[0].reviewDueAt).toBe("confirmed-deadline");
});


test("background settings do not replace the original expected value and only conscious comparison permits a new basis", async () => {
  const bases: number[] = [];
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: { ...initial, project: { ...initial.project, reviewObjectionWindowHours: 72 } } }),
    saveReviewWindow: async (expected, hours) => { bases.push(expected); return { project: { id: initial.project.id, reviewObjectionWindowHours: hours }, sprints: [] }; },
  } });
  const editor = planning.beginReviewWindowEdit(48);
  await planning.refreshWorkspace("sprint");
  await expect(editor.save(96)).resolves.toMatchObject({ ok: false, kind: "versionConflict" });
  expect(bases).toEqual([]);
  expect(editor.view()).toMatchObject({ phase: "conflict", submittedHours: 96, canResave: false });
  await expect(editor.refreshConflict()).resolves.toBe(true);
  expect(editor.view()).toMatchObject({ serverHours: 72, submittedHours: 96, canResave: true });
  await expect(editor.resave(96)).resolves.toMatchObject({ ok: true });
  expect(bases).toEqual([72]);
});


test("unknown Review-window outcomes retain input after release and safely pause dependent writes without replay", async () => {
  let writes = 0, reads = 0, sprintWrites = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    saveTask: async (_, patch) => ({ task: { ...patch, updatedAt: "task/new" } }),
    saveReviewWindow: async () => { writes++; throw new Error("Response lost"); },
    saveSprint: async (basis, patch) => { sprintWrites++; return { sprint: { ...basis, ...patch, updatedAt: "opaque/saved" } }; },
    readWorkspace: async () => { reads++; return { data: initial }; },
  } });
  const editor = planning.beginReviewWindowEdit(48);
  await expect(editor.save(72)).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  editor.close();
  expect(planning.reviewWindow().edits[0]).toMatchObject({ phase: "unconfirmed", submittedHours: 72 });
  await expect(planning.beginReviewWindowEdit(48).save(96)).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  await expect(planning.beginSprintEdit(open).save({ status: "active" })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  await expect(planning.checkReviewWindowSave()).resolves.toMatchObject({ outcome: "unconfirmed" });
  expect({ writes, reads, sprintWrites }).toEqual({ writes: 1, reads: 1, sprintWrites: 0 });
  await expect(planning.saveTask(task, { title: "Independent" })).resolves.toMatchObject({ ok: true });
  expect(planning.reviewWindow().edits[0].phase).toBe("unconfirmed");
});


test("an unsent window draft pauses for a pending Sprint and can be consciously saved after its known confirmation", async () => {
  const schedule = deferred<{ sprint: typeof open }>();
  let writes = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }), saveSprint: () => schedule.promise,
    saveReviewWindow: async (_expected, hours) => { writes++; return { project: { id: initial.project.id, reviewObjectionWindowHours: hours }, sprints: [] }; },
  } });
  const pending = planning.beginSprintEdit(open).save({ status: "active" });
  const editor = planning.beginReviewWindowEdit(48);
  await expect(editor.save(72)).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  expect(editor.view()).toMatchObject({ phase: "blocked", submittedHours: 72 });
  expect(writes).toBe(0);
  schedule.resolve({ sprint: { ...open, updatedAt: "opaque/schedule" } }); await pending;
  await planning.checkReviewWindowSave();
  expect(editor.view()).toMatchObject({ phase: "editing", submittedHours: 72 });
  await expect(editor.save(72)).resolves.toMatchObject({ ok: true });
  expect(writes).toBe(1);
});


test.each([{ status: 403, code: "forbidden", kind: "rejected" }, { status: 409, code: "session_superseded", kind: "sessionSuperseded" }])("Review-window rejection %s preserves independent confirmed task work and the submitted value", async failure => {
  const response = deferred<never>();
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }), saveTask: async (_, patch) => ({ task: { ...patch, updatedAt: "task/new" } }), saveReviewWindow: () => response.promise,
  } });
  const editor = planning.beginReviewWindowEdit(48);
  const save = editor.save(72);
  await planning.saveTask(task, { title: "Confirmed task" });
  response.reject(Object.assign(new Error("Request denied"), failure));
  await expect(save).resolves.toMatchObject({ ok: false, kind: failure.kind });
  expect(editor.view().submittedHours).toBe(72);
  expect(planning.taskDetail(task.id).task?.title).toBe("Confirmed task");
  expect(planning.sprintWorkspace().model.sprints[0].reviewDueAt).toBe("old-deadline");
});

test("an older project read and a legacy whole-shell rollback cannot undo a confirmed Review window", async () => {
  const old = deferred<{ data: typeof initial; coverage: { project: "complete" } }>();
  const after = deferred<{ data: typeof initial }>();
  const owner = createPlanningState({ userId: "user", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: workspace => workspace === "profile" ? old.promise : after.promise,
    saveReviewWindow: async () => ({ project: { id: initial.project.id, reviewObjectionWindowHours: 72 }, sprints: [{ id: open.id, reviewDueAt: "new-deadline" }] }),
  } });
  const read = owner.planning.refreshWorkspace("profile");
  await owner.planning.beginReviewWindowEdit(48).save(72);
  old.resolve({ data: initial, coverage: { project: "complete" } }); await read;
  owner.internal.applyLegacyProjection(initial);
  expect(owner.planning.reviewWindow().hours).toBe(72);
  expect(owner.planning.sprintWorkspace().model.sprints[0].reviewDueAt).toBe("new-deadline");
});

test("a partial deadline confirmation does not grant a fabricated basis to a new ordinary Sprint editor", async () => {
  const after = deferred<{ data: typeof initial }>();
  let sprintWrites = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: () => after.promise,
    saveReviewWindow: async () => ({ project: { id: initial.project.id, reviewObjectionWindowHours: 72 }, sprints: [{ id: open.id, reviewDueAt: "new-deadline" }] }),
    saveSprint: async () => { sprintWrites++; return { sprint: open }; },
  } });
  await planning.beginReviewWindowEdit(48).save(72);
  const shown = planning.sprintWorkspace().model.sprints[0];
  await expect(planning.beginSprintEdit(shown).save({ status: "active" })).resolves.toMatchObject({ ok: false, code: "sprint_basis_missing" });
  expect(sprintWrites).toBe(0);
});

test("a lost Review-window response cannot be accepted after a replaced account", async () => {
  const response = deferred<{ project: { id: string; reviewObjectionWindowHours: number }; sprints: [] }>();
  const owner = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }), saveReviewWindow: () => response.promise } });
  const editor = owner.planning.beginReviewWindowEdit(48);
  const save = editor.save(72);
  owner.internal.sessionChanged("replacement");
  response.resolve({ project: { id: initial.project.id, reviewObjectionWindowHours: 72 }, sprints: [] });
  await expect(save).resolves.toMatchObject({ ok: false, kind: "sessionSuperseded" });
  expect(editor.view()).toMatchObject({ phase: "ended", submittedHours: null });
  expect(owner.planning.reviewWindow()).toMatchObject({ hours: null, edits: [] });
});


test("a remounted Review-window editor resumes the retained conflict and original expected value", async () => {
  let writes = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: { ...initial, project: { ...initial.project, reviewObjectionWindowHours: 72 } } }),
    saveReviewWindow: async () => { writes++; return { project: { id: initial.project.id, reviewObjectionWindowHours: 96 }, sprints: [] }; },
  } });
  const editor = planning.beginReviewWindowEdit(48);
  await planning.refreshWorkspace("sprint");
  await editor.save(96); editor.close();
  const resumed = planning.resumeReviewWindowEdit();
  expect(resumed?.view()).toMatchObject({ phase: "conflict", submittedHours: 96 });
  await expect(resumed!.save(96)).resolves.toMatchObject({ ok: false, kind: "versionConflict" });
  expect(writes).toBe(0);
});


test("a dependent Sprint check reports the ended session when its read finishes after account replacement", async () => {
  const schedule = deferred<{ sprint: typeof open }>();
  const read = deferred<{ data: typeof initial }>();
  const owner = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task }), readWorkspace: () => read.promise, saveSprint: () => schedule.promise } });
  const pending = owner.planning.beginSprintEdit(open).save({ status: "active" });
  await owner.planning.beginReviewWindowEdit(48).save(72);
  const check = owner.planning.checkReviewWindowSave();
  owner.internal.sessionChanged("replacement");
  read.resolve({ data: initial });
  await expect(check).resolves.toMatchObject({ outcome: "session-ended", readStatus: "not-needed" });
  schedule.resolve({ sprint: open }); await pending;
});
