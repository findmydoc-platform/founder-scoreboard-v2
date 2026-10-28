import type { Task } from "@/lib/types";
import type { TaskGitHubSyncCommand, TaskGitHubProjectionResult, TaskGitHubSyncClientClassification, GitHubCommentDeliverySummary } from "@/lib/github-sync/contract";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
import type { GitHubUserConnectionState } from "@/features/planning/model/github-app-connection";
export type TaskGitHubSyncView = {
    taskId: string;
    phase: "queued" | "syncing" | "confirmed" | "locked" | "retryable" | "rejected" | "partiallyConfirmed" | "unconfirmed" | "blocked" | "ended";
    submitted: Readonly<{
        task: Task;
        command: TaskGitHubSyncCommand;
    }> | null;
    receipt: TaskGitHubProjectionResult | null;
    error: string;
    taskReadStatus: PlanningReadStatus;
    checking: boolean;
    retryAllowed: boolean;
    serverTask: Task | null;
};
export type GitHubConnectionSnapshot = {
    installationAvailable: boolean;
    userConnected: boolean;
    state: GitHubUserConnectionState;
    waitingCommentCount: number | null;
};
export type GitHubConnectionView = GitHubConnectionSnapshot & {
    readStatus: PlanningReadStatus;
};
export type GitHubSyncBatchView = {
    phase: "idle" | "running" | "complete";
    taskIds: readonly string[];
    skippedTaskIds: readonly string[];
    commentDelivery: GitHubCommentDeliverySummary;
    notice: string;
};
export type TaskGitHubSyncAdapter = {
    syncTaskGitHub?: (taskId: string, command: TaskGitHubSyncCommand) => Promise<TaskGitHubSyncClientClassification>;
    readGitHubConnection?: () => Promise<GitHubConnectionSnapshot>;
};
export interface PlanningTaskGitHubSync {
    syncTaskToGitHub(task: Task, command?: Partial<TaskGitHubSyncCommand> & {
        automatic?: boolean;
    }): Promise<TaskGitHubSyncView>;
    syncGitHubTasks(options?: {
        onlyFailed?: boolean;
    }): Promise<GitHubSyncBatchView>;
    taskGitHubSync(taskId: string): TaskGitHubSyncView | null;
    taskGitHubSyncs(): readonly TaskGitHubSyncView[];
    githubSyncBatch(): GitHubSyncBatchView;
    githubSyncNotice(): string;
    checkTaskGitHubSync(taskId: string): Promise<PlanningTaskSaveCheck>;
    githubConnection(): GitHubConnectionView;
    loadGitHubConnection(): Promise<boolean>;
}
