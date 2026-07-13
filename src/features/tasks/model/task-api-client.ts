"use client";

import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { TaskDetailData } from "@/lib/task-detail-data";
import type { ApprovalDecisionAction, PlanningData, Task, TaskActivity, TaskExternalComment, TaskRelation } from "@/lib/types";

export function decideTaskApprovalRequest(apiClient: BrowserApiClient, taskId: string, action: ApprovalDecisionAction, expectedRevision: number, note = "") {
  return apiClient.requestJson<{ error?: string; task?: Task }>(`/api/tasks/${taskId}/approval`, {
    method: "POST",
    json: { action, expectedRevision, note },
  });
}

export function updateTaskRequest(apiClient: BrowserApiClient, taskId: string, patch: unknown) {
  return apiClient.requestJson<{ error?: string; activities?: TaskActivity[]; task?: Partial<Task> }>(`/api/tasks/${taskId}`, {
    method: "PATCH",
    json: patch,
  });
}

export type BacklogMovePlacement = "before" | "after";

export type BacklogMoveRequest = {
  taskId: string;
  targetTaskId: string;
  placement: BacklogMovePlacement;
  expectedTaskUpdatedAt: string;
  expectedTargetUpdatedAt: string;
};

export type BacklogMoveUpdate = {
  id: string;
  sortOrder: number;
  updatedAt: string;
};

export function moveBacklogTaskRequest(apiClient: BrowserApiClient, move: BacklogMoveRequest) {
  return apiClient.requestJson<{ error?: string; updates?: BacklogMoveUpdate[] }>("/api/tasks/backlog-order", {
    method: "PATCH",
    json: move,
  });
}

export function withdrawTaskRequest(apiClient: BrowserApiClient, taskId: string, expectedRevision: number, reason: string) {
  return apiClient.requestJson<{ error?: string; affectedTaskIds?: string[]; trashRevision?: number; eventIds?: Array<string | number> }>(`/api/tasks/${taskId}/withdraw`, {
    method: "POST",
    json: { expectedRevision, reason },
  });
}

export function restoreTaskRequest(apiClient: BrowserApiClient, taskId: string, expectedTrashRevision: number) {
  return apiClient.requestJson<{ error?: string; affectedTaskIds?: string[]; trashRevision?: number; eventIds?: Array<string | number> }>(`/api/tasks/${taskId}/restore`, {
    method: "POST",
    json: { expectedTrashRevision },
  });
}

export function requestTaskDetailData(apiClient: BrowserApiClient, taskId: string) {
  return apiClient.requestJson<{ error?: string; detailData?: TaskDetailData }>(`/api/tasks/${taskId}/detail-data`);
}

export function mergeTaskDetailData(current: PlanningData, taskId: string, detailData: TaskDetailData): PlanningData {
  return {
    ...current,
    taskComments: [
      ...detailData.taskComments,
      ...current.taskComments.filter((comment) => comment.taskId !== taskId),
    ],
    taskExternalComments: [
      ...detailData.taskExternalComments,
      ...current.taskExternalComments.filter((comment) => comment.taskId !== taskId),
    ],
    taskBlockers: [
      ...detailData.taskBlockers,
      ...current.taskBlockers.filter((blocker) => blocker.taskId !== taskId),
    ],
    taskActivity: [
      ...detailData.taskActivity,
      ...current.taskActivity.filter((activity) => activity.taskId !== taskId),
    ],
    taskRelations: [
      ...detailData.taskRelations,
      ...current.taskRelations.filter((relation) => relation.taskId !== taskId && relation.relatedTaskId !== taskId),
    ],
  };
}

export function createTaskRequest(apiClient: BrowserApiClient, draft: unknown) {
  return apiClient.requestJson<{
    error?: string;
    task?: Task;
    relation?: TaskRelation | null;
    relatedTask?: (Partial<Task> & { id: string }) | null;
  }>("/api/tasks", {
    method: "POST",
    json: draft,
  });
}

export function syncTaskToGitHubRequest(apiClient: BrowserApiClient, taskId: string, options: { createIfMissing?: boolean } = {}) {
  return apiClient.requestJson<{
    code?: string;
    error?: string;
    task?: Partial<Task>;
    commentDelivery?: {
      delivered: number;
      reconciled: number;
      created: number;
      waitingForAuthorConnection: number;
      waitingForIssue: number;
      retryScheduled: number;
      failed: number;
    };
    notices?: Array<{ code: string; level: "info" | "warning"; message: string }>;
  }>(`/api/tasks/${taskId}/sync-github`, {
    method: "POST",
    json: { createIfMissing: Boolean(options.createIfMissing) },
  });
}

export function createTaskCommentRequest(apiClient: BrowserApiClient, taskId: string, comment: string) {
  return apiClient.requestJson<{
    error?: string;
    notice?: { code: string; level: "info"; message: string } | null;
    comment?: PlanningData["taskComments"][number];
  }>(`/api/tasks/${taskId}/comments`, {
    method: "POST",
    json: { comment },
  });
}

export function uploadTaskAttachmentRequest(apiClient: BrowserApiClient, taskId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiClient.requestForm<{ error?: string; markdown?: string }>(`/api/tasks/${taskId}/attachments`, formData, {
  });
}

export function importGitHubCommentsRequest(apiClient: BrowserApiClient, taskId: string) {
  return apiClient.requestJson<{ error?: string; imported?: number; evidenceLink?: string; comments?: TaskExternalComment[] }>(`/api/tasks/${taskId}/github-comments`, {
    method: "POST",
  });
}

export function addTaskRelationshipRequest(apiClient: BrowserApiClient, taskId: string, payload: unknown) {
  return apiClient.requestJson<{ error?: string; relation?: TaskRelation }>(`/api/tasks/${taskId}/relationships`, {
    method: "POST",
    json: payload,
  });
}

export function removeTaskRelationshipRequest(apiClient: BrowserApiClient, taskId: string, relationId: number) {
  return apiClient.requestJson<{ error?: string }>(`/api/tasks/${taskId}/relationships`, {
    method: "DELETE",
    json: { relationId },
  });
}

export function reportTaskBlockerRequest(apiClient: BrowserApiClient, taskId: string, payload: unknown) {
  return apiClient.requestJson<{ error?: string; blocker?: PlanningData["taskBlockers"][number] }>(`/api/tasks/${taskId}/blockers`, {
    method: "POST",
    json: payload,
  });
}

export function reviewTaskRequest(apiClient: BrowserApiClient, taskId: string, payload: unknown) {
  return apiClient.requestJson<{ error?: string }>(`/api/tasks/${taskId}/review`, {
    method: "POST",
    json: payload,
  });
}

export function reopenTaskReviewRequest(apiClient: BrowserApiClient, taskId: string) {
  return apiClient.requestJson<{ error?: string; task?: Partial<Task> }>(`/api/tasks/${taskId}/review/reopen`, {
    method: "POST",
  });
}

export function loadGitHubAssetBlob(apiClient: BrowserApiClient, href: string) {
  return apiClient.requestBlob(`/api/github-assets?url=${encodeURIComponent(href)}`, {
  });
}
