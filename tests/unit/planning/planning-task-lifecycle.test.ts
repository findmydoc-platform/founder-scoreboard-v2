import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
import type { Task } from "@/lib/types";

const original = taskDetailStoryTask({ id: "existing", title: "Existing", updatedAt: "opaque/r1" });
const draft = { creationRequestId: "request-a", taskType: "deliverable" as const, title: "New proposal", description: "Context", parentTaskId: "initiative", ownerId: "founder", githubRepo: "findmydoc-platform/management" };
const initial = { ...emptyPlanningShellState, tasks: [original] };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("creation displays only its temporary item until authoritative task and related-record confirmation reach views and cache", async () => {
  const response = deferred<{ task: Task; relatedTask: Partial<Task> & { id: string } }>();
  const oldRead = deferred<{ data: typeof initial }>();
  const created = taskDetailStoryTask({ id: "created", title: "New proposal", updatedAt: "opaque/new", approvalStatus: "proposed", sprintId: "" });
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: () => oldRead.promise,
    createTask: () => response.promise,
    saveTask: async () => ({ task: original }),
  } });
  const refresh = planning.refreshWorkspace("planning");
  const create = planning.createTask(draft);
  expect(planning.board().tasks.find(task => task.title === "New proposal")).toMatchObject({ approvalStatus: "proposed", sprintId: "" });
  expect(planning.protectedCache()?.tasks).toHaveLength(1);
  response.resolve({ task: created, relatedTask: { id: original.id, status: "Blockiert", updatedAt: "opaque/related" } });
  await expect(create).resolves.toMatchObject({ ok: true, task: { id: "created" } });
  oldRead.resolve({ data: initial });
  await refresh;
  expect(planning.board().tasks.map(task => task.id).sort()).toEqual(["created", "existing"]);
  expect(planning.taskDetail(original.id).task).toMatchObject({ status: "Blockiert", updatedAt: "opaque/related" });
  expect(planning.protectedCache()?.tasks.find(task => task.id === created.id)).toMatchObject({ approvalStatus: "proposed", sprintId: "", updatedAt: "opaque/new" });
});


test("withdrawal removes exactly its confirmed scope and late reads, related data and earlier write confirmations cannot restore it", async () => {
  const root = { ...original, id: "root", approvalStatus: "proposed" as const };
  const child = { ...original, id: "child", taskType: "sub_issue" as const, parentTaskId: root.id };
  const hiddenChild = { ...child, id: "previously-unloaded-child" };
  const data = { ...initial, tasks: [original, root, child], taskComments: [{ id: 1, taskId: child.id, comment: "Removed discussion" }] as typeof initial.taskComments, taskReviews: [{ id: 2, taskId: child.id }] as typeof initial.taskReviews };
  const read = deferred<{ data: typeof data }>();
  const write = deferred<{ task: Partial<Task> }>();
  const removal = deferred<{ affectedTaskIds: string[] }>();
  const { planning } = createPlanningState({ userId: "user", initialData: data, adapter: {
    readWorkspace: () => read.promise, saveTask: () => write.promise, removeTask: () => removal.promise,
  } });
  const refresh = planning.refreshWorkspace("planning");
  const olderWrite = planning.beginTaskEdit(child).save({ title: "Old dispatched edit" });
  const withdraw = planning.withdrawTask(root, "No longer needed");
  expect(planning.board().tasks.map(task => task.id)).toEqual([original.id]);
  expect(planning.protectedCache()?.tasks).toHaveLength(3);
  removal.resolve({ affectedTaskIds: [root.id, child.id] });
  await expect(withdraw).resolves.toMatchObject({ ok: true });
  write.resolve({ task: { title: "Late confirmation", updatedAt: "opaque/late" } });
  await expect(olderWrite).resolves.toMatchObject({ ok: false, kind: "rejected", code: "task_removed" });
  read.resolve({ data: { ...data, tasks: [...data.tasks, hiddenChild] } });
  await refresh;
  expect(planning.board().tasks.map(task => task.id)).toEqual([original.id]);
  expect(planning.protectedCache()?.tasks.map(task => task.id)).toEqual([original.id]);
  expect(planning.taskDetail(child.id)).toMatchObject({ task: null, comments: [], reviews: [] });
  expect(planning.taskDetail(hiddenChild.id).task).toBeNull();
});


test("unknown creation and removal keep their submissions and checks never repeat a mutation", async () => {
  let creates = 0;
  let removes = 0;
  let reads = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => { reads++; return { data: initial }; },
    readTaskDetail: async () => { reads++; throw Object.assign(new Error("Not available"), { status: 404 }); },
    createTask: async () => { creates++; throw new Error("Response lost"); },
    removeTask: async () => { removes++; throw new Error("Response lost"); },
    saveTask: async () => ({ task: original }),
  } });
  await expect(planning.createTask(draft)).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  const creation = planning.taskLifecycle().find(operation => operation.kind === "create")!;
  await expect(planning.checkTaskLifecycle(creation.id)).resolves.toMatchObject({ outcome: "unconfirmed" });
  await expect(planning.createTask(draft)).resolves.toMatchObject({ ok: false });
  await expect(planning.withdrawTask(original, "Retained reason")).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  const removal = planning.taskLifecycle().find(operation => operation.kind === "withdraw")!;
  await expect(planning.checkTaskLifecycle(removal.id)).resolves.toMatchObject({ outcome: "unconfirmed" });
  expect(planning.taskLifecycle()).toMatchObject([
    { kind: "create", phase: "unconfirmed", submitted: { title: "New proposal" }, checkStatus: "checked" },
    { kind: "withdraw", phase: "unconfirmed", submitted: { reason: "Retained reason" }, checkStatus: "unavailable" },
  ]);
  expect({ creates, removes, reads }).toEqual({ creates: 1, removes: 1, reads: 2 });
});


test("an unknown root removal pauses dependent task writes and child creation while independent records remain editable", async () => {
  const root = { ...original, id: "root", approvalStatus: "proposed" as const };
  let creates = 0;
  const writes: string[] = [];
  const { planning } = createPlanningState({ userId: "user", initialData: { ...initial, tasks: [original, root] }, adapter: {
    readWorkspace: async () => ({ data: initial }),
    removeTask: async () => { throw new Error("Response lost"); },
    createTask: async () => { creates++; return { task: original }; },
    saveTask: async (task, patch) => { writes.push(task.id); return { task: { ...patch, updatedAt: "opaque/confirmed" } }; },
  } });
  await planning.withdrawTask(root, "Uncertain root removal");
  const editor = planning.beginTaskEdit(root);
  await expect(editor.save({ title: "Dependent input" })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  await expect(planning.createTask({ ...draft, taskType: "sub_issue", parentTaskId: root.id })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  expect(planning.taskLifecycle().find(operation => operation.kind === "create")).toMatchObject({ phase: "blocked", submitted: { parentTaskId: root.id } });
  expect(editor.view().submitted).toEqual({ title: "Dependent input" });
  await expect(planning.beginTaskEdit(original).save({ title: "Independent change" })).resolves.toMatchObject({ ok: true });
  expect({ writes, creates }).toEqual({ writes: [original.id], creates: 0 });
});


test("a confirmed creation survives a later approval failure and the original request cannot create a duplicate", async () => {
  let creates = 0;
  const created = taskDetailStoryTask({ id: "confirmed-proposal", title: draft.title, approvalStatus: "proposed", sprintId: "", updatedAt: "opaque/created" });
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }), saveTask: async () => ({ task: original }),
    createTask: async () => { creates++; return { task: created, approvalError: "Die Aufgabe wurde erstellt. Die Freigabe ist fehlgeschlagen." }; },
  } });
  await expect(planning.createTask({ ...draft, approveNow: true })).resolves.toMatchObject({ ok: false, kind: "partiallyConfirmed", task: { id: created.id } });
  expect(planning.taskLifecycle()[0]).toMatchObject({ phase: "partiallyConfirmed", taskId: created.id });
  expect(planning.board().tasks.find(task => task.id === created.id)).toMatchObject({ approvalStatus: "proposed", sprintId: "" });
  expect(planning.protectedCache()?.tasks.find(task => task.id === created.id)?.updatedAt).toBe("opaque/created");
  await planning.createTask({ ...draft, approveNow: true });
  expect(creates).toBe(1);
});


test.each(["create", "withdraw", "reject"] as const)("a known unauthorized %s rejection restores only its own display effect and preserves an independent confirmation", async action => {
  const rejected = deferred<never>();
  const removedRoot = { ...original, id: "other-root" };
  const { planning } = createPlanningState({ userId: "user", initialData: action === "create" ? initial : { ...initial, tasks: [original, removedRoot] }, adapter: {
    readWorkspace: async () => ({ data: initial }), createTask: () => rejected.promise, removeTask: () => rejected.promise,
    saveTask: async (_, patch) => ({ task: { ...patch, updatedAt: "opaque/independent" } }),
  } });
  const operation = action === "create" ? planning.createTask(draft) : action === "withdraw" ? planning.withdrawTask(removedRoot, "No permission") : planning.rejectTask(removedRoot, "No permission");
  await planning.beginTaskEdit(original).save({ title: "Confirmed independently" });
  rejected.reject(Object.assign(new Error("Not permitted"), { status: 403 }));
  await expect(operation).resolves.toMatchObject({ ok: false, kind: "rejected", status: 403 });
  expect(planning.board().tasks).toHaveLength(action === "create" ? 1 : 2);
  expect(planning.protectedCache()?.tasks[0]).toMatchObject({ title: "Confirmed independently", updatedAt: "opaque/independent" });
  expect(planning.taskLifecycle()[0].phase).toBe("rejected");
});

test("a creation confirmation for an already removed parent cannot restore a child or its related effects", async () => {
  const root = { ...original, id: "root" };
  const response = deferred<{ task: Task; relatedTask: Partial<Task> & { id: string } }>();
  const { planning } = createPlanningState({ userId: "user", initialData: { ...initial, tasks: [original, root] }, adapter: {
    readWorkspace: async () => ({ data: initial }), saveTask: async () => ({ task: original }), createTask: () => response.promise,
    removeTask: async () => ({ affectedTaskIds: [root.id] }),
  } });
  const create = planning.createTask({ ...draft, taskType: "sub_issue", parentTaskId: root.id });
  await planning.withdrawTask(root, "Removed while create response was delayed");
  response.resolve({ task: taskDetailStoryTask({ id: "late-child", taskType: "sub_issue", parentTaskId: root.id, updatedAt: "opaque/late" }), relatedTask: { id: original.id, status: "Blockiert", updatedAt: "opaque/related-late" } });
  await expect(create).resolves.toMatchObject({ ok: false, kind: "rejected" });
  expect(planning.board().tasks.map(task => task.id)).toEqual([original.id]);
  expect(planning.taskDetail(original.id).task?.status).toBe("Offen");
});

test.each(["create", "withdraw"] as const)("late %s confirmation cannot repopulate a replaced account", async action => {
  const response = deferred<{ task: Task; affectedTaskIds: string[] }>();
  let changed!: (userId: string | null) => void;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }), saveTask: async () => ({ task: original }),
    createTask: () => response.promise, removeTask: () => response.promise,
    subscribeSession: listener => { changed = listener; return () => {}; },
  } });
  const operation = action === "create" ? planning.createTask(draft) : planning.withdrawTask(original, "Removed");
  changed("other-user");
  response.resolve({ task: taskDetailStoryTask({ id: "late", updatedAt: "opaque/late" }), affectedTaskIds: [original.id] });
  await expect(operation).resolves.toMatchObject({ ok: false, kind: "sessionSuperseded" });
  expect(planning.taskLifecycle()).toEqual([]);
  expect(planning.board().tasks).toEqual([]);
  expect(planning.protectedCache()).toBeNull();
});


test("a read of the unchanged related record during creation cannot discard its explicit create confirmation", async () => {
  const response = deferred<{ task: Task; relatedTask: Partial<Task> & { id: string } }>();
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }), saveTask: async () => ({ task: original }), createTask: () => response.promise,
  } });
  const create = planning.createTask({ ...draft, relatedTaskId: original.id });
  await planning.refreshWorkspace("planning");
  response.resolve({ task: taskDetailStoryTask({ id: "created", updatedAt: "opaque/new" }), relatedTask: { id: original.id, status: "Blockiert", updatedAt: "opaque/related" } });
  await create;
  expect(planning.taskDetail(original.id).task).toMatchObject({ status: "Blockiert", updatedAt: "opaque/related" });
});


test("a created relationship survives an older complete detail response while a later complete read can confirm its removal", async () => {
  const old = deferred<{ model: TaskDetailModel }>();
  const model: TaskDetailModel = { revision: "detail", project: initial.project, item: original, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [], coverage: { relationships: "complete" as const } };
  let reads = 0;
  const relation = { id: 42, taskId: "created", relatedTaskId: original.id, relationType: "relates_to" as const, note: "New relation", createdBy: "user", createdAt: "now" };
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }), saveTask: async () => ({ task: original }),
    readTaskDetail: () => ++reads === 1 ? old.promise : Promise.resolve({ model }),
    createTask: async () => ({ task: taskDetailStoryTask({ id: "created", updatedAt: "opaque/new" }), relation }),
  } });
  const read = planning.loadTaskDetail(original.id);
  await planning.createTask(draft);
  old.resolve({ model });
  await read;
  expect(planning.taskDetail(original.id).relationships).toEqual([relation]);
  await planning.loadTaskDetail(original.id);
  expect(planning.taskDetail(original.id).relationships).toEqual([]);
});
