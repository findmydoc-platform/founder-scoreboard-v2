"use client";

import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, Task, TaskActivity, TaskExternalComment, TaskRelation } from "@/lib/types";

export function updateTaskRequest(apiClient: BrowserApiClient, taskId: string, patch: unknown) {
  return apiClient.requestJson<{ error?: string; activities?: TaskActivity[]; task?: Partial<Task> }>(`/api/tasks/${taskId}`, {
    method: "PATCH",
    json: patch,
  });
}

export function deleteTaskRequest(apiClient: BrowserApiClient, taskId: string) {
  return apiClient.requestJson<{ error?: string }>(`/api/tasks/${taskId}`, {
    method: "DELETE",
    jsonContentType: false,
  });
}

export function createTaskRequest(apiClient: BrowserApiClient, draft: unknown) {
  return apiClient.requestJson<{ error?: string; task?: Task }>("/api/tasks", {
    method: "POST",
    json: draft,
  });
}

export function syncTaskToGitHubRequest(apiClient: BrowserApiClient, taskId: string, options: { createIfMissing?: boolean } = {}) {
  return apiClient.requestJson<{ error?: string; task?: Partial<Task> }>(`/api/tasks/${taskId}/sync-github`, {
    method: "POST",
    json: { createIfMissing: Boolean(options.createIfMissing) },
  });
}

export function createTaskCommentRequest(apiClient: BrowserApiClient, taskId: string, comment: string) {
  return apiClient.requestJson<{ error?: string; githubSyncError?: string; comment?: PlanningData["taskComments"][number] }>(`/api/tasks/${taskId}/comments`, {
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
