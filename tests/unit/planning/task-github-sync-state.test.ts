import { expect, test } from "vitest";
import { createPlanningState, type PlanningStateAdapter } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { classifyTaskGitHubSyncResponse, taskGitHubSyncFailure, type TaskGitHubProjectionSuccess } from "@/lib/github-sync/contract";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
const task = taskDetailStoryTask({ id: "task", title: "Original task", updatedAt: "2026-10-28T10:00:00Z", githubIssueSyncStatus: "not_synced", githubRepo: "example/project", githubIssueNumber: 7, githubIssueUrl: "https://github.com/example/project/issues/7" });
const success: TaskGitHubProjectionSuccess = { ok: true, code: "github_sync_succeeded", issue: { repository: "example/project", number: 7, url: "https://github.com/example/project/issues/7", recovered: false, recreated: false }, task: { githubIssueSyncStatus: "synced", githubIssueSyncError: "", updatedAt: "2026-10-28T10:01:00Z" }, warnings: [], notices: [], commentDelivery: { delivered: 0, reconciled: 0, created: 0, waitingForAuthorConnection: 0, waitingForIssue: 0, retryScheduled: 0, failed: 0 } };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function detail(patch = {}): TaskDetailModel { return { revision: "read", project: emptyPlanningShellState.project, item: { ...task, ...patch }, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [], coverage: { timeline: "complete", discussion: "complete" } }; }
function fixture(adapter: Partial<PlanningStateAdapter> = {}) { return createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [task] }, adapter: { readWorkspace: async () => null, saveTask: async (_, patch) => ({ task: { ...patch, updatedAt: "2026-10-28T10:02:00Z" } }), ...adapter } }); }
test("single projection shares pending display, accepts the actual revision and fences an older detail read", async () => {
    const response = deferred<ReturnType<typeof classifyTaskGitHubSyncResponse>>(), old = deferred<{
        model: TaskDetailModel;
    }>();
    let reads = 0;
    const { planning } = fixture({ syncTaskGitHub: () => response.promise, readTaskDetail: () => ++reads === 1 ? old.promise : Promise.resolve({ model: detail(success.task) }) });
    const reading = planning.loadTaskDetail(task.id), writing = planning.syncTaskToGitHub(task, { createIfMissing: false });
    expect(planning.board().tasks[0].githubIssueSyncStatus).toBe("pending");
    expect(planning.protectedCache()?.tasks[0]).toMatchObject({ githubIssueSyncStatus: "not_synced", updatedAt: task.updatedAt });
    response.resolve(classifyTaskGitHubSyncResponse(200, success));
    expect(await writing).toMatchObject({ phase: "confirmed" });
    old.resolve({ model: detail() });
    await reading;
    await Promise.resolve();
    expect(reads).toBe(2);
    expect(planning.board().tasks[0]).toMatchObject({ githubIssueSyncStatus: "synced", updatedAt: success.task.updatedAt });
    expect(planning.taskGitHubSync(task.id)).toMatchObject({ phase: "confirmed", receipt: { ok: true } });
});
test("a lost projection response retains intent and matching safe GET never proves or repeats it", async () => {
    let writes = 0, reads = 0;
    const { planning } = fixture({ syncTaskGitHub: async () => { writes++; throw new Error("Response lost"); }, readTaskDetail: async () => { reads++; return { model: detail({ githubIssueSyncStatus: "synced", updatedAt: success.task.updatedAt }) }; } });
    expect(await planning.syncTaskToGitHub(task)).toMatchObject({ phase: "unconfirmed", submitted: { task: { updatedAt: task.updatedAt }, command: { createIfMissing: false } } });
    expect(reads).toBe(0);
    await Promise.all([planning.checkTaskGitHubSync(task.id), planning.checkTaskGitHubSync(task.id)]);
    expect(planning.taskGitHubSync(task.id)).toMatchObject({ phase: "unconfirmed", taskReadStatus: "current", serverTask: { githubIssueSyncStatus: "synced" } });
    expect(await planning.syncTaskToGitHub(task)).toMatchObject({ phase: "blocked" });
    expect(await planning.saveTask(task, { title: "Dependent" })).toMatchObject({ kind: "unconfirmed" });
    expect({ writes, reads }).toEqual({ writes: 1, reads: 1 });
});
test("cleanup failure retains the actual finalized Task patch and separate retryable outcome", async () => {
    const receipt = taskGitHubSyncFailure("github_sync_unavailable", "Lock release failed", success.task);
    const { planning } = fixture({ syncTaskGitHub: async () => classifyTaskGitHubSyncResponse(503, receipt) });
    expect(await planning.syncTaskToGitHub(task)).toMatchObject({ phase: "partiallyConfirmed", receipt, retryAllowed: true });
    expect(planning.protectedCache()?.tasks[0]).toMatchObject({ githubIssueSyncStatus: "synced", updatedAt: success.task.updatedAt });
});
test("projection and ordinary edits use actual revisions without rebasing an already opened Task editor", async () => {
    const revisions: string[] = [];
    const { planning } = fixture({ saveTask: async (basis, patch) => { revisions.push(basis.updatedAt!); return { task: { ...patch, updatedAt: "2026-10-28T10:03:00Z" } }; }, syncTaskGitHub: async () => classifyTaskGitHubSyncResponse(200, success) });
    const old = planning.beginTaskEdit(task);
    await planning.syncTaskToGitHub(task);
    expect(await old.save({ title: "Old draft" })).toMatchObject({ kind: "versionConflict" });
    expect(revisions).toEqual([]);
    const current = planning.taskDetail(task.id).task!;
    expect(await planning.saveTask(current, { title: "New deliberate draft" })).toMatchObject({ ok: true });
    expect(revisions).toEqual([success.task.updatedAt]);
});
test("an older projection receipt cannot overwrite a later accepted task and triggers a scoped actual reread", async () => {
    const response = deferred<ReturnType<typeof classifyTaskGitHubSyncResponse>>();
    let reads = 0;
    const newer = { title: "Later foreign edit", githubIssueSyncStatus: "not_synced", updatedAt: "2026-10-28T10:05:00Z" };
    const { planning } = fixture({ syncTaskGitHub: () => response.promise, readTaskDetail: async () => { reads++; return { model: detail(newer) }; } });
    const writing = planning.syncTaskToGitHub(task);
    await planning.loadTaskDetail(task.id);
    response.resolve(classifyTaskGitHubSyncResponse(200, success));
    await writing;
    await planning.checkTaskGitHubSync(task.id);
    expect(planning.taskDetail(task.id).task).toMatchObject(newer);
    expect(planning.taskGitHubSync(task.id)?.receipt).toEqual(success);
    expect(reads).toBe(2);
});
test("bulk preserves parent ordering, skips its dependent child after failure and aggregates only returned delivery facts", async () => {
    const parent = { ...task, id: "parent", title: "A parent" }, child = { ...task, id: "child", title: "A child", taskType: "sub_issue" as const, parentTaskId: parent.id }, other = { ...task, id: "other", title: "B independent" };
    const calls: string[] = [];
    let statusReads = 0;
    const { planning } = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [child, other, parent] }, adapter: { readWorkspace: async () => null, saveTask: async () => ({ task: {} }), readGitHubConnection: async () => { statusReads++; return { installationAvailable: true, userConnected: true, state: "connected", waitingCommentCount: 12 }; }, syncTaskGitHub: async (id) => { calls.push(id); return id === parent.id ? classifyTaskGitHubSyncResponse(409, taskGitHubSyncFailure("github_sync_invalid_target", "Parent failed")) : classifyTaskGitHubSyncResponse(200, { ...success, commentDelivery: { ...success.commentDelivery, delivered: 3 } }); } } });
    await planning.loadGitHubConnection();
    const result = await planning.syncGitHubTasks();
    expect(calls).toEqual([parent.id, other.id]);
    expect(result).toMatchObject({ phase: "complete", skippedTaskIds: [child.id], commentDelivery: { delivered: 3 } });
    expect(result.notice).toContain("3 zugestellt");
    await Promise.resolve();
    expect(statusReads).toBe(2);
    expect(planning.githubConnection().waitingCommentCount).toBe(12);
    expect(planning.taskGitHubSync(child.id)).toMatchObject({ phase: "blocked" });
});
test("session replacement stops a retained batch before dispatching its next Task", async () => {
    const response = deferred<ReturnType<typeof classifyTaskGitHubSyncResponse>>();
    const calls: string[] = [];
    const other = { ...task, id: "other", title: "Z next" };
    const owner = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [task, other] }, adapter: { readWorkspace: async () => null, saveTask: async () => ({ task: {} }), syncTaskGitHub: id => { calls.push(id); return response.promise; } } });
    const running = owner.planning.syncGitHubTasks();
    owner.internal.sessionChanged("replacement");
    response.resolve(classifyTaskGitHubSyncResponse(200, success));
    await running;
    expect(calls).toEqual([task.id]);
    expect(owner.planning.taskGitHubSyncs()).toEqual([]);
    expect(owner.planning.githubConnection().waitingCommentCount).toBeNull();
    expect(owner.planning.protectedCache()).toBeNull();
});
test("task authority recovery cannot admit a projection response from before the denial", async () => {
    const response = deferred<ReturnType<typeof classifyTaskGitHubSyncResponse>>();
    let reads = 0;
    const { planning } = fixture({ syncTaskGitHub: () => response.promise, readTaskDetail: async () => { if (++reads === 1)
            throw Object.assign(new Error("Denied"), { status: 403 }); return { model: detail({ title: "Fresh authorized Task", updatedAt: "2026-10-28T10:05:00Z" }) }; } });
    const writing = planning.syncTaskToGitHub(task);
    await planning.loadTaskDetail(task.id);
    await planning.loadTaskDetail(task.id);
    response.resolve(classifyTaskGitHubSyncResponse(200, success));
    expect(await writing).toMatchObject({ phase: "ended" });
    expect(planning.taskGitHubSync(task.id)).toBeNull();
    expect(planning.taskDetail(task.id).task).toMatchObject({ title: "Fresh authorized Task", updatedAt: "2026-10-28T10:05:00Z" });
});
test("an in-flight pre-effect connection read cannot restore an older waiting count after sync", async () => {
    const old = deferred<{
        installationAvailable: boolean;
        userConnected: boolean;
        state: "connected";
        waitingCommentCount: number;
    }>();
    let reads = 0;
    const { planning } = fixture({ readGitHubConnection: () => ++reads === 1 ? old.promise : Promise.resolve({ installationAvailable: true, userConnected: true, state: "connected", waitingCommentCount: 5 }), syncTaskGitHub: async () => classifyTaskGitHubSyncResponse(200, success) });
    const reading = planning.loadGitHubConnection();
    await planning.syncTaskToGitHub(task);
    expect(planning.githubConnection().waitingCommentCount).toBeNull();
    old.resolve({ installationAvailable: true, userConnected: true, state: "connected", waitingCommentCount: 100 });
    await reading;
    await planning.loadGitHubConnection();
    expect(reads).toBe(2);
    expect(planning.githubConnection()).toMatchObject({ waitingCommentCount: 5, state: "connected", readStatus: "current" });
});
test("manual feedback replaces an older batch notice while an automatic follow-up keeps it quiet", async () => {
    let replies = 0;
    const notice = { code: "notice", level: "info" as const, message: "Latest individual result" };
    const { planning } = fixture({ syncTaskGitHub: async () => classifyTaskGitHubSyncResponse(200, { ...success, commentDelivery: { ...success.commentDelivery, delivered: ++replies }, notices: [notice] }) });
    await planning.syncGitHubTasks();
    expect(planning.githubSyncNotice()).toContain("1 zugestellt");
    await planning.syncTaskToGitHub(planning.taskDetail(task.id).task!, { automatic: true });
    expect(planning.githubSyncNotice()).toContain("1 zugestellt");
    await planning.syncTaskToGitHub(planning.taskDetail(task.id).task!);
    expect(planning.githubSyncNotice()).toBe(notice.message);
});
test("an unresolved parent projection is excluded together with its child from a later batch", async () => {
    const parent = { ...task, id: "parent", title: "A parent" }, child = { ...task, id: "child", title: "A child", taskType: "sub_issue" as const, parentTaskId: "parent" };
    let writes = 0;
    const { planning } = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [parent, child] }, adapter: { readWorkspace: async () => null, saveTask: async () => ({ task: {} }), syncTaskGitHub: async () => { writes++; throw new Error("Unknown parent"); } } });
    await planning.syncTaskToGitHub(parent);
    await planning.syncGitHubTasks();
    expect(writes).toBe(1);
    expect(await planning.syncTaskToGitHub(child)).toMatchObject({ phase: "blocked" });
});
test("a known before-dispatch credential rejection does not become an unknown provider effect", async () => {
    const { planning } = fixture({ syncTaskGitHub: async () => { throw Object.assign(new Error("Active session required"), { status: 401 }); } });
    expect(await planning.syncTaskToGitHub(task)).toMatchObject({ phase: "rejected" });
    expect(planning.protectedCache()?.tasks[0].updatedAt).toBe(task.updatedAt);
});

test("a batch does not leave a never-dispatched Task queued behind an ordinary pending save", async () => {
    const saved = deferred<{ task: Partial<typeof task> }>();
    let writes = 0;
    const { planning } = fixture({ saveTask: () => saved.promise, syncTaskGitHub: async () => { writes++; return classifyTaskGitHubSyncResponse(200, success); } });
    const saving = planning.saveTask(task, { title: "Pending ordinary edit" });
    await planning.syncGitHubTasks();
    expect(writes).toBe(0);
    expect(planning.taskGitHubSync(task.id)).toMatchObject({ phase: "blocked" });
    expect(planning.board().tasks[0].githubIssueSyncStatus).toBe("not_synced");
    saved.resolve({ task: { title: "Pending ordinary edit", updatedAt: "2026-10-28T10:06:00Z" } });
    await saving;
});
