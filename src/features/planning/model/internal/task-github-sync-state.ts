import type { PlanningShellState, Task } from "@/lib/types";
import type { TaskGitHubSyncPatch, TaskGitHubSyncCommand, TaskGitHubSyncClientClassification, GitHubCommentDeliverySummary } from "@/lib/github-sync/contract";
import type { TaskGitHubSyncAdapter, TaskGitHubSyncView, GitHubSyncBatchView } from "@/features/tasks/model/task-github-sync-state";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "../planning-state";
import { githubBulkSyncTasks } from "@/features/tasks/model/github-sync-queue";
import { hasGitHubIssue } from "@/lib/platform";
const emptyDelivery = (): GitHubCommentDeliverySummary => ({ delivered: 0, reconciled: 0, created: 0, waitingForAuthorConnection: 0, waitingForIssue: 0, retryScheduled: 0, failed: 0 });
type Operation = {
    startedAt: string;
    view: TaskGitHubSyncView;
    after: number;
    uncertain: boolean;
    needsTaskRead: boolean;
    classification?: TaskGitHubSyncClientClassification;
};
export function createTaskGitHubSyncState(options: {
    adapter: TaskGitHubSyncAdapter;
    current(): PlanningShellState;
    active(): boolean;
    generation(): number;
    changed(): void;
    nextSequence(): number;
    canRead(id: string): boolean;
    dependencyPending(task: Task): boolean;
    accept(task: Task, patch: TaskGitHubSyncPatch, started: number): boolean;
    invalidateTask(id: string): void;
    refresh(id: string, after: number): Promise<PlanningReadStatus>;
    timelineLoaded(id: string): boolean;
    invalidateConnection(): void;
    endSession(): void;
    now(): number;
}) {
    const operations = new Map<string, Operation>();
    const checks = new Map<string, Promise<PlanningTaskSaveCheck>>();
    const authorities = new Map<string, number>();
    let batch: GitHubSyncBatchView = { phase: "idle", taskIds: [], skippedTaskIds: [], commentDelivery: emptyDelivery(), notice: "" };
    let batchPromise: Promise<GitHubSyncBatchView> | null = null;
    let feedbackSequence = 0;
    let feedbackNotice = "";
    const current = (id: string) => options.active() && options.canRead(id);
    const unresolved = (operation: Operation) => operation.view.phase === "syncing" || operation.uncertain || operation.needsTaskRead && operation.view.taskReadStatus !== "current";
    const blocksTask = (id: string) => { const operation = operations.get(id); return Boolean(operation && unresolved(operation)); };
    const parentPending = (task: Task) => task.taskType === "sub_issue" && blocksTask(task.parentTaskId);
    const view = (id: string) => {
        const operation = operations.get(id);
        if (!current(id) || !operation)
            return null;
        return structuredClone({ ...operation.view, retryAllowed: operation.view.retryAllowed && !operation.uncertain && (!operation.needsTaskRead || operation.view.taskReadStatus === "current") });
    };
    function ended(id: string): TaskGitHubSyncView {
        return { taskId: id, phase: "ended", submitted: null, receipt: null, error: "Die Sitzung oder der Zugriff wurde beendet.", taskReadStatus: "not-loaded", checking: false, retryAllowed: false, serverTask: null };
    }
    function blocked(task: Task, command: TaskGitHubSyncCommand, error: string): TaskGitHubSyncView {
        return { taskId: task.id, phase: "blocked", submitted: structuredClone({ task, command }), receipt: null, error, taskReadStatus: "not-loaded", checking: false, retryAllowed: false, serverTask: null };
    }
    function readNeeded(operation: Operation) {
        operation.after = options.nextSequence();
        operation.needsTaskRead = true;
        operation.view.taskReadStatus = "stale";
        options.invalidateTask(operation.view.taskId);
    }
    function check(id: string, refreshConnection = true): Promise<PlanningTaskSaveCheck> {
        if (!options.active() || !current(id))
            return Promise.resolve({ outcome: "session-ended", readStatus: "not-needed" });
        const operation = operations.get(id);
        if (!operation)
            return Promise.resolve({ outcome: "not-pending", readStatus: "not-needed" });
        const existing = checks.get(id);
        if (existing)
            return existing;
        const generation = options.generation(), authority = authorities.get(id) || 0;
        operation.view.checking = true;
        options.changed();
        const checking = (async (): Promise<PlanningTaskSaveCheck> => {
            const status = await options.refresh(id, operation.after);
            if (!options.active() || generation !== options.generation() || !current(id) || authority !== (authorities.get(id) || 0))
                return { outcome: "session-ended", readStatus: "not-needed" };
            operation.view.checking = false;
            operation.view.taskReadStatus = status;
            operation.view.serverTask = status === "current" || status === "stale" ? structuredClone(options.current().tasks.find(task => task.id === id) || null) : null;
            options.changed();
            if (refreshConnection)
                options.invalidateConnection();
            return { outcome: operation.uncertain || operation.needsTaskRead && status !== "current" ? "unconfirmed" : "not-pending", readStatus: status };
        })();
        checks.set(id, checking);
        void checking.finally(() => { if (checks.get(id) === checking)
            checks.delete(id); });
        return checking;
    }
    async function sync(task: Task, command: TaskGitHubSyncCommand = { createIfMissing: false }, inBatch = false, automatic = false): Promise<TaskGitHubSyncView> {
        if (!current(task.id))
            return ended(task.id);
        const feedback = !inBatch && !automatic ? ++feedbackSequence : null;
        if (feedback !== null)
            feedbackNotice = "";
        const previous = operations.get(task.id);
        if (previous && (unresolved(previous) || previous.view.phase === "queued" && !inBatch))
            return blocked(task, command, "Dieser GitHub-Sync ist noch offen. Prüfe zuerst seinen Stand.");
        if (parentPending(task) || options.dependencyPending(task))
            return blocked(task, command, "Eine abhängige Aufgabenänderung ist noch offen. Der GitHub-Sync wurde nicht gesendet.");
        if (!options.adapter.syncTaskGitHub)
            return blocked(task, command, "GitHub-Sync ist nicht verfügbar.");
        const generation = options.generation(), authority = authorities.get(task.id) || 0, started = options.nextSequence();
        const operation: Operation = { startedAt: new Date(options.now()).toISOString(), after: started, uncertain: false, needsTaskRead: false, view: { taskId: task.id, phase: "syncing", submitted: structuredClone({ task, command }), receipt: null, error: "", taskReadStatus: "not-loaded", checking: false, retryAllowed: false, serverTask: null } };
        operations.set(task.id, operation);
        options.changed();
        const valid = () => current(task.id) && generation === options.generation() && authority === (authorities.get(task.id) || 0);
        try {
            const classification = await options.adapter.syncTaskGitHub(task.id, structuredClone(command));
            if (!valid())
                return ended(task.id);
            operation.classification = classification;
            const receipt = classification.result;
            operation.view.receipt = structuredClone(receipt);
            if (feedback !== null && feedback === feedbackSequence)
                feedbackNotice = receipt.ok ? receipt.notices[0]?.message || "" : "";
            operation.view.error = receipt.ok ? "" : receipt.error;
            operation.view.retryAllowed = !receipt.ok && receipt.retryable && classification.kind !== "locked";
            const patch = receipt.task;
            const versioned = Boolean(patch?.updatedAt);
            const accepted = versioned && options.accept(task, patch!, started);
            if (classification.kind === "success") {
                operation.view.phase = versioned ? "confirmed" : "partiallyConfirmed";
                operation.uncertain = !versioned;
            }
            else {
                operation.view.phase = versioned && patch?.githubIssueSyncStatus === "synced" ? "partiallyConfirmed" : classification.kind === "locked" ? "locked" : classification.kind === "retryable" ? "retryable" : "rejected";
            }
            // Unversioned lock/status advice is display guidance, not a stored Task revision.
            if (patch && !versioned || versioned && !accepted || classification.kind === "retryable" && !patch)
                readNeeded(operation);
            const loadedEffects = options.timelineLoaded(task.id) && (versioned || receipt.ok);
            options.changed();
            if (operation.needsTaskRead || loadedEffects)
                void check(task.id, false);
            if (!inBatch && (receipt.ok || receipt.task?.githubIssueSyncStatus === "synced"))
                options.invalidateConnection();
            return structuredClone(operation.view);
        }
        catch (error) {
            if (!valid())
                return ended(task.id);
            const failure = error && typeof error === "object" ? error as {
                code?: string;
                message?: string;
                status?: number;
            } : {};
            if (failure.code === "session_superseded") {
                options.endSession();
                return ended(task.id);
            }
            if (failure.status && failure.status >= 400 && failure.status < 500) {
                operation.view.phase = "rejected";
                operation.view.error = failure.message || "Der GitHub-Sync wurde abgelehnt.";
                options.changed();
                return structuredClone(operation.view);
            }
            operation.uncertain = true;
            operation.view.phase = "unconfirmed";
            operation.view.error = failure.message || "Die GitHub-Synchronisierung ist noch nicht bestätigt.";
            readNeeded(operation);
            options.changed();
            if (!inBatch)
                options.invalidateConnection();
            return structuredClone(operation.view);
        }
    }
    function summary(delivery: GitHubCommentDeliverySummary) {
        const parts = [delivery.delivered ? `${delivery.delivered} zugestellt` : "", delivery.waitingForAuthorConnection ? `${delivery.waitingForAuthorConnection} warten auf die Verbindung ihrer Autoren` : "", delivery.waitingForIssue ? `${delivery.waitingForIssue} warten auf ein Issue` : "", delivery.retryScheduled ? `${delivery.retryScheduled} für erneuten Versuch eingeplant` : "", delivery.failed ? `${delivery.failed} fehlgeschlagen` : ""].filter(Boolean);
        return parts.length ? `Kommentarzustellung: ${parts.join(" · ")}.` : "";
    }
    function syncBatch(input: {
        onlyFailed?: boolean;
    } = {}): Promise<GitHubSyncBatchView> {
        if (batchPromise)
            return batchPromise;
        if (!options.active())
            return Promise.resolve(structuredClone(batch));
        const data = options.current();
        const openCommentTaskIds = new Set(data.taskComments.filter(comment => comment.githubDeliveryStatus !== "delivered").map(comment => comment.taskId));
        const failedCommentTaskIds = new Set(data.taskComments.filter(comment => comment.githubDeliveryStatus === "failed").map(comment => comment.taskId));
        const tasks = githubBulkSyncTasks({ tasks: data.tasks, openCommentTaskIds, failedCommentTaskIds, onlyFailed: input.onlyFailed }).filter(task => current(task.id) && !blocksTask(task.id) && !parentPending(task));
        const generation = options.generation(), feedback = ++feedbackSequence;
        feedbackNotice = "";
        batch = { phase: "running", taskIds: tasks.map(task => task.id), skippedTaskIds: [], commentDelivery: emptyDelivery(), notice: "" };
        for (const task of tasks)
            operations.set(task.id, { startedAt: new Date(options.now()).toISOString(), after: 0, uncertain: false, needsTaskRead: false, view: { ...blocked(task, { createIfMissing: !hasGitHubIssue(task) }, ""), phase: "queued" } });
        options.changed();
        const running = (async () => {
            const failedParents = new Set<string>();
            for (const task of tasks) {
                if (!options.active() || generation !== options.generation())
                    break;
                if (task.taskType === "sub_issue" && failedParents.has(task.parentTaskId)) {
                    batch = { ...batch, skippedTaskIds: [...batch.skippedTaskIds, task.id] };
                    operations.get(task.id)!.view = blocked(task, { createIfMissing: !hasGitHubIssue(task) }, "Der GitHub-Abgleich der übergeordneten Aufgabe ist noch unklar. Dieses Sub-Issue wurde noch nicht übertragen.");
                    options.changed();
                    continue;
                }
                const result = await sync(task, { createIfMissing: !hasGitHubIssue(task) }, true);
                if (!options.active() || generation !== options.generation())
                    break;
                const queued = operations.get(task.id);
                if (result.phase === "blocked" && queued?.view.phase === "queued") {
                    queued.view = result;
                    options.changed();
                }
                if (result.phase !== "confirmed" && task.taskType === "deliverable")
                    failedParents.add(task.id);
                if (result.receipt?.ok) {
                    for (const key of Object.keys(batch.commentDelivery) as Array<keyof GitHubCommentDeliverySummary>) {
                        const count = result.receipt.commentDelivery[key];
                        if (Number.isSafeInteger(count) && count >= 0)
                            batch.commentDelivery[key] += count;
                    }
                }
            }
            if (options.active() && generation === options.generation()) {
                batch = { ...batch, phase: "complete", notice: summary(batch.commentDelivery) };
                if (feedback === feedbackSequence)
                    feedbackNotice = batch.notice;
                options.changed();
                if (tasks.length)
                    options.invalidateConnection();
            }
            return structuredClone(batch);
        })();
        batchPromise = running;
        void running.finally(() => { if (batchPromise === running)
            batchPromise = null; });
        return running;
    }
    return {
        sync: (task: Task, command?: Partial<TaskGitHubSyncCommand> & {
            automatic?: boolean;
        }) => sync(task, { createIfMissing: Boolean(command?.createIfMissing) }, false, Boolean(command?.automatic)),
        notice: () => options.active() ? feedbackNotice : "",
        syncBatch,
        check,
        blocksTask,
        view,
        views: () => [...operations.keys()].flatMap(id => { const value = view(id); return value ? [value] : []; }),
        batch: () => options.active() ? structuredClone(batch) : { phase: "idle" as const, taskIds: [], skippedTaskIds: [], commentDelivery: emptyDelivery(), notice: "" },
        acceptTaskRead(id: string, started: number, accepted: boolean, revision?: string) {
            const operation = operations.get(id);
            if (operation && accepted && revision && started > operation.after)
                operation.view.taskReadStatus = "current";
        },
        protect(data: PlanningShellState): PlanningShellState {
            return { ...data, tasks: data.tasks.map(task => { const operation = operations.get(task.id); return operation && operation.needsTaskRead && operation.view.taskReadStatus !== "current" ? { ...task, updatedAt: undefined } : task; }) };
        },
        projectVisible(data: PlanningShellState): PlanningShellState {
            return { ...data, tasks: data.tasks.map(task => {
                    const operation = operations.get(task.id);
                    if (!operation)
                        return task;
                    if (operation.view.phase === "syncing" || operation.view.phase === "queued" || operation.uncertain)
                        return { ...task, githubIssueSyncStatus: "pending", githubIssueSyncError: operation.view.error, githubIssueSyncPendingSince: operation.startedAt };
                    if (operation.classification && operation.view.taskReadStatus !== "current" && !operation.view.receipt?.task?.updatedAt && operation.classification.kind !== "success")
                        return { ...task, githubIssueSyncStatus: operation.classification.taskStatus, githubIssueSyncError: operation.view.error, githubIssueSyncPendingSince: operation.classification.taskStatus === "pending" ? operation.startedAt : "" };
                    return task;
                }) };
        },
        deny(id: string) { authorities.set(id, (authorities.get(id) || 0) + 1); operations.delete(id); checks.delete(id); },
        clear() { feedbackSequence++; feedbackNotice = ""; operations.clear(); checks.clear(); authorities.clear(); batch = { phase: "idle", taskIds: [], skippedTaskIds: [], commentDelivery: emptyDelivery(), notice: "" }; batchPromise = null; },
    };
}
