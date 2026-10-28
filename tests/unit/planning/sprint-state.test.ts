import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";

const sprint = { id: "sprint", name: "Sprint shown", status: "planning" as const, startDate: "2026-10-01", endDate: "2026-10-14", reviewDueAt: "2026-10-15T12:00:00Z", scoreLocked: false, updatedAt: "opaque/initial" };
const task = taskDetailStoryTask({ id: "task", updatedAt: "task/basis" });
const initial = { ...emptyPlanningShellState, sprints: [sprint], tasks: [task] };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("an ordinary Sprint edit has a separate pending display and survives older reads and a legacy whole-shell rollback", async () => {
  const write = deferred<{ sprint: typeof sprint }>();
  const read = deferred<{ data: typeof initial }>();
  const owner = createPlanningState({ userId: "user", initialData: initial, adapter: {
    saveTask: async (_, patch) => ({ task: { ...patch, updatedAt: "task/confirmed" } }),
    saveSprint: () => write.promise,
    readWorkspace: () => read.promise,
  } });
  const refresh = owner.planning.refreshWorkspace("sprint");
  const editor = owner.planning.beginSprintEdit(sprint);
  const saved = editor.save({ name: "Edited Sprint" });
  expect(owner.planning.sprintWorkspace().model.sprints[0].name).toBe("Edited Sprint");
  expect(owner.planning.protectedCache()?.sprints[0].name).toBe("Sprint shown");
  await owner.planning.saveTask(task, { title: "Independent task" });
  write.resolve({ sprint: { ...sprint, name: "Edited Sprint", updatedAt: "opaque/confirmed" } });
  await expect(saved).resolves.toMatchObject({ ok: true });
  read.resolve({ data: initial });
  await refresh;
  owner.internal.applyLegacyProjection(initial);
  expect(owner.planning.sprintWorkspace().model.sprints[0]).toMatchObject({ name: "Edited Sprint", updatedAt: "opaque/confirmed" });
  expect(owner.planning.board().tasks[0].title).toBe("Independent task");
  expect(owner.planning.protectedCache()?.sprints[0].name).toBe("Edited Sprint");
});


test("unknown Sprint saves retain submitted input after editor release, block dependent writes and check read-only", async () => {
  let writes = 0;
  let reads = 0;
  const owner = createPlanningState({ userId: "user", initialData: initial, adapter: {
    saveTask: async (_, patch) => ({ task: { ...patch, updatedAt: "task/confirmed" } }),
    saveSprint: async () => { writes++; throw new Error("Response lost"); },
    readWorkspace: async () => { reads++; return { data: initial }; },
  } });
  const editor = owner.planning.beginSprintEdit(sprint);
  await expect(editor.save({ status: "active" })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  editor.close();
  expect(owner.planning.sprintEdits(sprint.id)[0]).toMatchObject({ phase: "unconfirmed", submitted: { status: "active" } });
  await expect(owner.planning.beginSprintEdit(sprint).save({ name: "Dependent" })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  await expect(editor.checkOutcome()).resolves.toMatchObject({ outcome: "unconfirmed" });
  expect({ writes, reads }).toEqual({ writes: 1, reads: 1 });
  expect(owner.planning.protectedCache()?.sprints[0].status).toBe("planning");
  await expect(owner.planning.saveTask(task, { title: "Independent" })).resolves.toMatchObject({ ok: true });
});


test("a Sprint editor keeps its displayed opaque basis across foreign reads and resaves only after explicit comparison", async () => {
  const calls: string[] = [];
  const foreign = { ...sprint, status: "review" as const, updatedAt: "opaque/foreign" };
  const owner = createPlanningState({ userId: "user", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: { ...initial, sprints: [foreign] } }),
    saveSprint: async (basis, patch) => { calls.push(basis.updatedAt!); return { sprint: { ...basis, ...patch, updatedAt: "opaque/resaved" } }; },
  } });
  const editor = owner.planning.beginSprintEdit(sprint);
  await owner.planning.refreshWorkspace("sprint");
  await expect(editor.save({ name: "Kept input" })).resolves.toMatchObject({ ok: false, kind: "versionConflict" });
  expect(calls).toEqual([]);
  expect(editor.view()).toMatchObject({ phase: "conflict", submitted: { name: "Kept input" }, canResave: false });
  await expect(editor.refreshConflict()).resolves.toBe(true);
  expect(editor.view()).toMatchObject({ serverSprint: { status: "review" }, canResave: true });
  await expect(editor.resave({ name: "Kept input" })).resolves.toMatchObject({ ok: true });
  expect(calls).toEqual(["opaque/foreign"]);
});


test("a partial Sprint scope merges returned identities without erasing meetings, commitments or settings omitted by the response", async () => {
  const second = { ...sprint, id: "other-sprint", name: "Retained" };
  const commitment = { id: 1, sprintId: sprint.id, profileId: "founder", commitmentLevel: "Standard" as const, weeklyHours: 30, note: "Retained" };
  const meeting = { id: 2, sprintId: sprint.id, title: "Retained meeting", meetingAt: "2026-10-14T10:00:00Z", durationMinutes: 30, status: "planned" as const, agenda: "" };
  const data = { ...initial, sprints: [sprint, second], sprintCommitments: [commitment], meetings: [meeting], project: { ...initial.project, reviewObjectionWindowHours: 72 } };
  const { planning } = createPlanningState({ userId: "user", initialData: data, initialWorkspace: "sprint", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: { ...emptyPlanningShellState, sprints: [{ ...sprint, status: "active" as const }] }, coverage: { sprints: "partial" } }),
  } });
  await planning.refreshWorkspace("sprint");
  const view = planning.sprintWorkspace();
  expect(view.model.sprints.map(item => item.id)).toEqual([sprint.id, second.id]);
  expect(view.model.commitments).toEqual([commitment]);
  expect(view.model.meetings).toEqual([meeting]);
  expect(view.model.project.reviewObjectionWindowHours).toBe(72);
  expect(view.model.coverage.sprints).toBe("partial");
  expect(view.model.coverage.meetings).not.toBe("complete");
});


test("an older cross-workspace settings read cannot replace accepted Sprint settings while independent scope identities remain usable", async () => {
  const old = deferred<{ data: typeof initial; coverage: { project: "complete" } }>();
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: workspace => workspace === "profile" ? old.promise : Promise.resolve({ data: { ...initial, project: { ...initial.project, reviewObjectionWindowHours: 96 } }, coverage: { project: "complete" } }),
  } });
  const prior = planning.refreshWorkspace("profile");
  await planning.refreshWorkspace("sprint");
  old.resolve({ data: { ...initial, project: { ...initial.project, reviewObjectionWindowHours: 48 } }, coverage: { project: "complete" } });
  await prior;
  expect(planning.sprintWorkspace().model.project.reviewObjectionWindowHours).toBe(96);
});


test("only the same Sprint editor's confirmed predecessor advances a queued opaque basis", async () => {
  const first = deferred<{ sprint: typeof sprint }>();
  const bases: string[] = [];
  let writes = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }), saveTask: async () => ({ task }),
    saveSprint: async (basis, patch) => { bases.push(basis.updatedAt!); writes++; return writes === 1 ? first.promise : { sprint: { ...basis, ...patch, updatedAt: "opaque/second" } }; },
  } });
  const own = planning.beginSprintEdit(sprint);
  const other = planning.beginSprintEdit(sprint);
  const one = own.save({ name: "Own one" });
  const two = own.save({ status: "active" });
  first.resolve({ sprint: { ...sprint, name: "Own one", updatedAt: "opaque/first" } });
  await one; await expect(two).resolves.toMatchObject({ ok: true });
  await expect(other.save({ endDate: "2026-10-20" })).resolves.toMatchObject({ ok: false, kind: "versionConflict" });
  expect(bases).toEqual(["opaque/initial", "opaque/first"]);
});

test.each(["sprint_locked", "sprint_protected", "session_superseded"])("Sprint error %s does not become a genuine revision conflict", async code => {
  const write = deferred<never>();
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }), saveTask: async (_, patch) => ({ task: { ...patch, updatedAt: "task/independent" } }),
    saveSprint: () => write.promise,
  } });
  const editor = planning.beginSprintEdit(sprint);
  const saved = editor.save({ name: "Retained Sprint name" });
  await planning.saveTask(task, { title: "Independent task" });
  write.reject(Object.assign(new Error("Rejected by server"), { status: 409, code }));
  await expect(saved).resolves.toMatchObject({ ok: false, kind: code === "session_superseded" ? "sessionSuperseded" : "rejected" });
  expect(editor.view().phase).toBe(code === "session_superseded" ? "unconfirmed" : "rejected");
  expect(planning.board().tasks[0].title).toBe("Independent task");
  expect(planning.protectedCache()?.sprints[0].name).toBe("Sprint shown");
});

test("a late Sprint confirmation after account replacement cannot repopulate state or submitted input", async () => {
  const response = deferred<{ sprint: typeof sprint }>();
  const owner = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }), saveTask: async () => ({ task }), saveSprint: () => response.promise,
  } });
  const editor = owner.planning.beginSprintEdit(sprint);
  const save = editor.save({ name: "Private draft" });
  owner.internal.sessionChanged("other-account");
  response.resolve({ sprint: { ...sprint, name: "Late", updatedAt: "opaque/late" } });
  await expect(save).resolves.toMatchObject({ ok: false, kind: "sessionSuperseded" });
  expect(owner.planning.sprintWorkspace().model.sprints).toEqual([]);
  expect(editor.view()).toMatchObject({ phase: "ended", submitted: null });
  expect(owner.planning.protectedCache()).toBeNull();
});


test("conflict comparison cannot rebase from a cached Sprint omitted by a partial read", async () => {
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: { ...emptyPlanningShellState, sprints: [] }, coverage: { sprints: "partial" } }), saveTask: async () => ({ task }),
    saveSprint: async () => { throw Object.assign(new Error("Changed Sprint"), { status: 409, code: "sprint_revision_conflict" }); },
  } });
  const editor = planning.beginSprintEdit(sprint);
  await editor.save({ name: "Kept input" });
  await expect(editor.refreshConflict()).resolves.toBe(false);
  expect(editor.view()).toMatchObject({ submitted: { name: "Kept input" }, serverSprint: null, canResave: false });
});


test("a rejected older Sprint read reports stale freshness rather than claiming its retained newer value was freshly read", async () => {
  const old = deferred<{ data: typeof initial }>();
  const { planning } = createPlanningState({ userId: "user", initialData: initial, initialWorkspace: "sprint", adapter: {
    readWorkspace: () => old.promise, saveTask: async () => ({ task }), saveSprint: async (basis, patch) => ({ sprint: { ...basis, ...patch, updatedAt: "opaque/saved" } }),
  } });
  const read = planning.refreshWorkspace("sprint");
  await planning.beginSprintEdit(sprint).save({ name: "Confirmed name" });
  old.resolve({ data: initial }); await read;
  expect(planning.sprintWorkspace().model.sprints[0].name).toBe("Confirmed name");
  expect(planning.sprintWorkspace().readStatus).toBe("stale");
});
