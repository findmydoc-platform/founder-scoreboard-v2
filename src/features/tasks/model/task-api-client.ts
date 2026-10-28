"use client";

import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { TaskDetailModel, TaskDetailUnavailableArea } from "@/features/tasks/model/task-detail-read-model";
import type { ApprovalDecisionAction, PlanningShellState, Task, TaskActivity, TaskExternalComment, TaskRelation, TaskReview } from "@/lib/types";
import type {
  TaskGitHubProjectionResult,
  TaskGitHubSyncCommand,
} from "@/lib/github-sync/contract";
import type { ReviewEvidenceSubmission } from "@/features/reviews/model/review-evidence";

export function decideTaskApprovalRequest(apiClient: BrowserApiClient, taskId: string, action: ApprovalDecisionAction, expectedRevision: number, note = "") {
  return apiClient.requestJson<{ error?: string; code?: string; conflictReason?: "revision"; task?: Task }>(`/api/tasks/${taskId}/approval`, {
    method: "POST",
    json: { action, expectedRevision, note },
  });
}

export function updateTaskRequest(apiClient: BrowserApiClient, taskId: string, patch: unknown) {
  return apiClient.requestJson<{ error?: string; code?: string; conflictReason?: "revision"; activities?: TaskActivity[]; task?: Partial<Task> }>(`/api/tasks/${taskId}`, {
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
  return apiClient.requestJson<{ error?: string; code?: string; completeness?: "complete" | "partial"; updates?: BacklogMoveUpdate[] }>("/api/tasks/backlog-order", {
    method: "PATCH",
    json: move,
  });
}

export type BulkSprintAssignmentRequest = {
  expectedSprintUpdatedAt?: string;
  assignments: Array<{ taskId: string; expectedUpdatedAt: string }>;
  sprintId: string;
};

export type BulkSprintAssignmentUpdate = {
  id: string;
  scoreRelevant: boolean;
  sprintId: string;
  updatedAt: string;
};

export function assignBacklogTasksToSprintRequest(apiClient: BrowserApiClient, payload: BulkSprintAssignmentRequest) {
  return apiClient.requestJson<{ error?: string; code?: string; updates?: BulkSprintAssignmentUpdate[] }>("/api/tasks/bulk-sprint-assignment", {
    method: "PATCH",
    json: payload,
  });
}

export function withdrawTaskRequest(apiClient: BrowserApiClient, taskId: string, expectedRevision: number, reason: string) {
  return apiClient.requestJson<{ error?: string; code?: string; affectedTaskIds?: string[]; trashRevision?: number; eventIds?: Array<string | number> }>(`/api/tasks/${taskId}/withdraw`, {
    method: "POST",
    json: { expectedRevision, reason },
  });
}

export function restoreTaskRequest(apiClient: BrowserApiClient, taskId: string, expectedTrashRevision: number) {
  return apiClient.requestJson<{ error?: string; code?: string; affectedTaskIds?: string[]; trashRevision?: number; eventIds?: Array<string | number> }>(`/api/tasks/${taskId}/restore`, {
    method: "POST",
    json: { expectedTrashRevision },
  });
}

export function requestTaskDetailData(apiClient: BrowserApiClient, taskId: string) {
  return apiClient.requestJson<{
    error?: string;
    taskDetail?: TaskDetailModel;
    unavailable?: TaskDetailUnavailableArea[];
  }>(`/api/tasks/${taskId}/detail-data`);
}

export function createTaskRequest(apiClient: BrowserApiClient, draft: unknown) {
  return apiClient.requestJson<{
    error?: string;
    code?: string;
    task?: Task;
    relation?: TaskRelation | null;
    relatedTask?: (Partial<Task> & { id: string }) | null;
  }>("/api/tasks", {
    method: "POST",
    json: draft,
  });
}

export function syncTaskToGitHubRequest(
  apiClient: BrowserApiClient,
  taskId: string,
  command: TaskGitHubSyncCommand,
  options: { expectedSession?: Pick<import("@/lib/credentials/browser").BrowserSessionSnapshot,"userId"|"revision"> } = {},
) {
  return apiClient.requestJson<TaskGitHubProjectionResult>(`/api/tasks/${taskId}/sync-github`, {
    method: "POST",
    ...options,
    json: command,
  });
}

export function createTaskCommentRequest(apiClient: BrowserApiClient, taskId: string, comment: string) {
  return apiClient.requestJson<{
    error?: string;
    code?: string;
    notice?: { code: string; level: "info"; message: string } | null;
    comment?: PlanningShellState["taskComments"][number];
  }>(`/api/tasks/${taskId}/comments`, {
    method: "POST",
    json: { comment },
  });
}

const pendingAttachmentOperations = new Map<string, string>();

export type TaskAttachmentAuthority = { userId: string; sessionRevision: string; isCurrent(): boolean };
export async function uploadTaskAttachmentRequest(apiClient: BrowserApiClient, taskId: string, file: File, authority?: TaskAttachmentAuthority) {
  const requireCurrent = () => { if (authority && !authority.isCurrent()) throw Object.assign(new Error("Die Sitzung wurde ersetzt."), { code: "session_superseded" }); };
  requireCurrent();
  const payload = new Uint8Array(await file.arrayBuffer());
  const identity = new TextEncoder().encode(`${authority?.userId || ""}\0${authority?.sessionRevision || ""}\0${taskId}\0${file.name}\0${file.type}\0`);
  const bytes = new Uint8Array(identity.length + payload.length);
  bytes.set(identity);
  bytes.set(payload, identity.length);
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  requireCurrent();
  const key = authority ? `founderops-attachment-${fingerprint}` : "";
  let operation = key ? pendingAttachmentOperations.get(key) : undefined;
  try {
    if (key) operation ||= sessionStorage.getItem(key) || undefined;
  } catch { /* Retain retries in memory when browser storage is unavailable. */ }
  operation ||= crypto.randomUUID();
  if (key) pendingAttachmentOperations.set(key, operation);
  try {
    if (key) sessionStorage.setItem(key, operation);
  } catch { /* The in-memory operation remains available. */ }
  const formData = new FormData();
  formData.append("file", file);
  const result = await apiClient.requestForm<Partial<import("./task-attachment-upload").TaskAttachmentReceipt> & { error?: string; code?: string }>(
    `/api/tasks/${taskId}/attachments`, formData, { headers: { "Idempotency-Key": operation }, ...(authority ? { expectedSession: { userId: authority.userId, revision: authority.sessionRevision } } : {}) },
  );
  if (result.response.ok && result.body?.markdown) {
    if (key) pendingAttachmentOperations.delete(key);
    try {
      if (key) sessionStorage.removeItem(key);
    } catch { /* The completed operation is already removed from memory. */ }
  }
  return result;
}

export function importGitHubCommentsRequest(apiClient: BrowserApiClient, taskId: string) {
  return apiClient.requestJson<{ error?: string; code?: string; imported?: number; evidenceLink?: string; comments?: TaskExternalComment[]; commentsCoverage?: "complete" | "partial" }>(`/api/tasks/${taskId}/github-comments`, {
    method: "POST",
  });
}

export function addTaskRelationshipRequest(apiClient: BrowserApiClient, taskId: string, payload: unknown) {
  return apiClient.requestJson<{ error?: string; code?: string; relation?: TaskRelation }>(`/api/tasks/${taskId}/relationships`, {
    method: "POST",
    json: payload,
  });
}

export function removeTaskRelationshipRequest(apiClient: BrowserApiClient, taskId: string, relationId: number, expectedUpdatedAt?: string) {
  return apiClient.requestJson<{ error?: string; code?: string; relationId?: number }>(`/api/tasks/${taskId}/relationships`, {
    method: "DELETE",
    json: { relationId, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) },
  });
}

export function reportTaskBlockerRequest(apiClient: BrowserApiClient, taskId: string, payload: unknown) {
  return apiClient.requestJson<{ error?: string; code?: string; blocker?: PlanningShellState["taskBlockers"][number] }>(`/api/tasks/${taskId}/blockers`, {
    method: "POST",
    json: payload,
  });
}

export function reviewTaskRequest(apiClient: BrowserApiClient, taskId: string, payload: unknown) {
  return apiClient.requestJson<{ error?: string; code?: string; conflictReason?: "revision"; activities?: TaskActivity[]; review?: TaskReview; task?: Partial<Task> }>(`/api/tasks/${taskId}/review`, {
    method: "POST",
    json: payload,
  });
}

export function withdrawTaskReviewRequest(apiClient: BrowserApiClient, taskId: string, reason: string, expectedUpdatedAt: string) {
  return apiClient.requestJson<{ error?: string; code?: string; conflictReason?: "revision"; activities?: TaskActivity[]; task?: Partial<Task> }>(`/api/tasks/${taskId}/review/withdraw`, {
    method: "POST",
    json: { reason, expectedUpdatedAt },
  });
}

export function reopenTaskReviewRequest(
  apiClient: BrowserApiClient,
  taskId: string,
  expectedUpdatedAt: string,
  evidence: ReviewEvidenceSubmission = {},
) {
  return apiClient.requestJson<{ error?: string; code?: string; conflictReason?: "revision"; activities?: TaskActivity[]; task?: Partial<Task> }>(`/api/tasks/${taskId}/review/reopen`, {
    method: "POST",
    json: {
      expectedUpdatedAt,
      evidenceLinks: evidence.evidenceLink ? [evidence.evidenceLink] : [],
      evidenceExceptionNote: evidence.evidenceExceptionNote || "",
    },
  });
}

export function loadGitHubAssetBlob(apiClient: BrowserApiClient, href: string) {
  return apiClient.requestBlob(`/api/github-assets?url=${encodeURIComponent(href)}`, {
  });
}
