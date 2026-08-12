"use client";

import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { ApprovalDecisionAction, AuthenticatedProfile, FmdTool, FounderEvent, MeetingAttendance, NotificationPreference, PlanningHeaderData, Profile, ProfileFeatureTourAcknowledgement, ProfileUiPreference, ScoreObjectionResolutionInput, Sprint, SprintCommitment, Task, TaskFocusItem } from "@/lib/types";
import type { EpicNotEmptyError, EpicDeleteRequest } from "@/features/projects/model/epic-contract";
import type { EpicDraft } from "@/features/projects/organisms/epic-dialog";
import type { InitiativeDraft } from "@/features/projects/organisms/initiative-dialog";
import type { FmdToolDraft, FmdToolMetadataDraft, FmdToolPreviewImageUpload } from "@/features/tools/model/fmd-tools";
import type { PlanningHeaderSlotKey } from "@/lib/planning-header-data";
import type { PlanningTaskRevision } from "@/features/planning/model/planning-revision";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import type { SupportingWorkspace, SupportingWorkspaceModel } from "@/features/planning/model/supporting-planning-shell-projection";
import type { SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";

type FmdToolPayload = FmdToolDraft & Pick<FmdTool, "status">;

export function requestPlanningWorkspaceData(apiClient: BrowserApiClient, workspace: "planning" | "projects") {
  const route = workspace === "planning" ? "/api/planning-board-data" : "/api/strategic-planning-data";
  return apiClient.requestJson<{
    model?: PlanningWorkspaceModel;
    headerData?: PlanningHeaderData;
    currentProfile?: AuthenticatedProfile | null;
    error?: string;
  }>(route);
}

export function requestSupportingWorkspaceData(apiClient: BrowserApiClient, workspace: SupportingWorkspace) {
  return apiClient.requestJson<{
    model?: SupportingWorkspaceModel;
    headerData?: PlanningHeaderData;
    currentProfile?: AuthenticatedProfile | null;
    error?: string;
  }>(`/api/${workspace}-data`);
}

export function requestSprintWorkspaceData(apiClient: BrowserApiClient) {
  return apiClient.requestJson<{
    model?: SprintWorkspaceModel;
    headerData?: PlanningHeaderData;
    currentProfile?: AuthenticatedProfile | null;
    error?: string;
  }>("/api/sprint-data");
}

export function requestPlanningShellStateRevision(apiClient: BrowserApiClient) {
  return apiClient.requestJson<{ error?: string; revision?: PlanningTaskRevision }>("/api/planning-revision");
}

export function requestPlanningHeaderData(apiClient: BrowserApiClient, slots?: readonly PlanningHeaderSlotKey[], options: { signal?: AbortSignal } = {}) {
  const query = slots?.length ? `?slots=${encodeURIComponent(slots.join(","))}` : "";
  return apiClient.requestJson<{ headerData?: PlanningHeaderData; error?: string }>(`/api/planning-header-data${query}`, options);
}

function strategicStatus(status: string) {
  if (status === "active") return "In Arbeit";
  if (status === "paused") return "Pausiert";
  if (status === "done") return "Erledigt";
  return "Offen";
}

function initiativeMutation(draft: InitiativeDraft, expectedUpdatedAt?: string) {
  return {
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    ...(!draft.id ? { taskType: "initiative" as const, creationRequestId: draft.creationRequestId } : {}),
    title: draft.title,
    description: draft.goal,
    ownerId: draft.ownerId,
    priority: draft.priority,
    status: strategicStatus(draft.status),
    targetDate: draft.targetDate,
    strategy: {
      goal: draft.goal,
      successCriteria: draft.successCriteria,
      scopeConstraints: draft.scopeConstraints,
    },
    raciAssignments: [
      { profileId: draft.accountableProfileId, role: "accountable", sortOrder: 0 },
      ...draft.responsibleProfileIds.map((profileId, sortOrder) => ({ profileId, role: "responsible", sortOrder })),
      ...draft.consultedProfileIds.map((profileId, sortOrder) => ({ profileId, role: "consulted", sortOrder })),
      ...draft.informedProfileIds.map((profileId, sortOrder) => ({ profileId, role: "informed", sortOrder })),
    ],
    ...(!draft.id ? { parentTaskId: draft.parentTaskId, approveNow: draft.approveNow } : {}),
  };
}

export async function saveInitiativeRequest(apiClient: BrowserApiClient, draft: InitiativeDraft) {
  if (!draft.id) {
    return apiClient.requestJson<{ error?: string; task?: Task }>("/api/tasks", {
      method: "POST",
      json: initiativeMutation(draft),
    });
  }
  let expectedUpdatedAt = draft.expectedUpdatedAt || "";
  const parentResult = await apiClient.requestJson<{ error?: string; task?: Task }>(`/api/tasks/${encodeURIComponent(draft.id)}`, {
    method: "PATCH",
    json: { expectedUpdatedAt, parentTaskId: draft.parentTaskId },
  });
  if (!parentResult.response.ok) return parentResult;
  expectedUpdatedAt = parentResult.body?.task?.updatedAt || expectedUpdatedAt;
  return apiClient.requestJson<{ error?: string; task?: Task }>(`/api/tasks/${encodeURIComponent(draft.id)}`, {
    method: "PATCH",
    json: initiativeMutation(draft, expectedUpdatedAt),
  });
}

export function saveEpicRequest(apiClient: BrowserApiClient, draft: EpicDraft) {
  const { id, expectedUpdatedAt } = draft;
  return apiClient.requestJson<{ task?: Task } | EpicNotEmptyError | { error?: string; code?: string }>(
    id ? `/api/tasks/${encodeURIComponent(id)}` : "/api/tasks",
    {
      method: id ? "PATCH" : "POST",
      json: {
        ...(id ? { expectedUpdatedAt } : { taskType: "epic", creationRequestId: draft.creationRequestId }),
        title: draft.title,
        description: draft.description,
        targetDate: draft.targetDate,
        status: strategicStatus(draft.status),
      },
    },
  );
}

export function deleteEpicRequest(apiClient: BrowserApiClient, epicId: string, payload: EpicDeleteRequest) {
  return apiClient.requestJson<{ task?: Partial<Task> & { id: string } } | EpicNotEmptyError | { error?: string; code?: string }>(
    `/api/tasks/${encodeURIComponent(epicId)}`,
    { method: "DELETE", json: payload },
  );
}

export function decideInitiativeApprovalRequest(apiClient: BrowserApiClient, initiativeId: string, action: ApprovalDecisionAction, expectedRevision: number, note = "") {
  return apiClient.requestJson<{ error?: string; task?: Task }>(`/api/tasks/${initiativeId}/approval`, {
    method: "POST",
    json: { action, expectedRevision, note },
  });
}

export function withdrawInitiativeRequest(apiClient: BrowserApiClient, initiativeId: string, expectedRevision: number, reason: string) {
  return apiClient.requestJson<{ error?: string; affectedTaskIds?: string[]; trashRevision?: number; eventIds?: Array<string | number> }>(`/api/tasks/${initiativeId}/withdraw`, {
    method: "POST",
    json: { expectedRevision, reason },
  });
}

export function restoreInitiativeRequest(apiClient: BrowserApiClient, initiativeId: string, expectedTrashRevision: number) {
  return apiClient.requestJson<{ error?: string; affectedTaskIds?: string[]; trashRevision?: number; eventIds?: Array<string | number> }>(`/api/tasks/${initiativeId}/restore`, {
    method: "POST",
    json: { expectedTrashRevision },
  });
}

export function saveFocusItemRequest(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<{ error?: string; focusItem?: TaskFocusItem }>("/api/focus", {
    method: "POST",
    json: payload,
  });
}

export function deleteFocusItemRequest(apiClient: BrowserApiClient, focusItemId: number) {
  return apiClient.requestJson<{ error?: string }>(`/api/focus?id=${encodeURIComponent(String(focusItemId))}`, {
    method: "DELETE",
    jsonContentType: false,
  });
}

export function updateSprintRequest(apiClient: BrowserApiClient, sprintId: string, payload: unknown) {
  return apiClient.requestJson<{ error?: string; sprint?: Sprint }>(`/api/sprints/${sprintId}`, {
    method: "PATCH",
    json: payload,
  });
}

export function createSprintPlanRequest(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<{ error?: string; sprints?: Sprint[] }>("/api/sprints", {
    method: "POST",
    json: payload,
  });
}

export function updateSprintCommitmentRequest(apiClient: BrowserApiClient, commitment: SprintCommitment) {
  return apiClient.requestJson<{ error?: string; commitment?: SprintCommitment }>("/api/sprint-commitments", {
    method: "PUT",
    json: commitment,
  });
}

export function updateProfileRequest(apiClient: BrowserApiClient, profileId: string, payload: unknown) {
  return apiClient.requestJson<{ error?: string; profile?: Profile; notificationPreferences?: NotificationPreference[] }>(`/api/profiles/${profileId}`, {
    method: "PATCH",
    json: payload,
  });
}

export function updateOwnProfileSettingsRequest(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<{
    error?: string;
    profile?: Profile;
    uiPreference?: ProfileUiPreference;
    notificationPreferences?: NotificationPreference[];
  }>("/api/profile-settings", {
    method: "PATCH",
    json: payload,
  });
}

export function updateFounderOpsReviewWindowRequest(
  apiClient: BrowserApiClient,
  expectedReviewObjectionWindowHours: number,
  reviewObjectionWindowHours: number,
) {
  return apiClient.requestJson<{
    error?: string;
    project?: { id: string; reviewObjectionWindowHours: number };
    sprints?: Array<{ id: string; reviewDueAt: string }>;
  }>("/api/founderops-settings", {
    method: "PATCH",
    json: { expectedReviewObjectionWindowHours, reviewObjectionWindowHours },
  });
}

export function updateFounderOpsGitHubProjectRequest(
  apiClient: BrowserApiClient,
  expectedGithubProjectOwner: string,
  expectedGithubProjectNumber: number,
  githubProjectOwner: string,
  githubProjectNumber: number,
) {
  return apiClient.requestJson<{
    error?: string;
    project?: { id: string; githubProjectOwner: string; githubProjectNumber: number };
    validation?: {
      title: string;
      url: string;
      repositories: string[];
      fields: Array<{ name: string; dataType: string }>;
    };
  }>("/api/founderops-settings/github-project", {
    method: "PATCH",
    json: {
      expectedGithubProjectOwner,
      expectedGithubProjectNumber,
      githubProjectOwner,
      githubProjectNumber,
    },
  });
}

export function markProfileFeatureTourSeenRequest(apiClient: BrowserApiClient, tourId: string) {
  return apiClient.requestJson<{ error?: string; acknowledgement?: ProfileFeatureTourAcknowledgement }>("/api/profile-feature-tours/seen", {
    method: "POST",
    json: { tourId },
  });
}

export function updateMeetingAttendanceRequest(apiClient: BrowserApiClient, meetingId: number, payload: unknown) {
  return apiClient.requestJson<{ error?: string; attendance?: MeetingAttendance }>(`/api/meetings/${meetingId}/attendance`, {
    method: "POST",
    json: payload,
  });
}

export function createFounderEventRequest(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<{ error?: string; event?: FounderEvent }>("/api/events", {
    method: "POST",
    json: payload,
  });
}

export function updateFounderEventRequest(apiClient: BrowserApiClient, eventId: number, payload: unknown) {
  return apiClient.requestJson<{ error?: string; event?: FounderEvent }>(`/api/events/${eventId}`, {
    method: "PATCH",
    json: payload,
  });
}

export function notificationDeliveryStatusRequest(apiClient: BrowserApiClient) {
  return apiClient.requestJson<{
    googleChat?: { webhookConfigured?: boolean; apiConfigured?: boolean; deliveryEnabled?: boolean; ready?: boolean; mode?: "direct-dm" | "space-webhook" | "not-configured" };
    googleChatConfigured?: boolean;
    pending?: number;
  }>("/api/notifications/deliver");
}

export function runNotificationDeliveryRequest(apiClient: BrowserApiClient, payload: Record<string, unknown>) {
  return apiClient.requestJson<{ error?: string; sent?: number; failed?: number; skipped?: number }>("/api/notifications/deliver", {
    method: "POST",
    json: payload,
  });
}

export function createFmdToolRequest(apiClient: BrowserApiClient, payload: FmdToolPayload) {
  return apiClient.requestJson<{ error?: string; tool?: FmdTool }>("/api/tools", {
    method: "POST",
    json: payload,
  });
}

export function updateFmdToolRequest(apiClient: BrowserApiClient, toolId: string, payload: FmdToolPayload) {
  return apiClient.requestJson<{ error?: string; tool?: FmdTool }>(`/api/tools/${encodeURIComponent(toolId)}`, {
    method: "PATCH",
    json: payload,
  });
}

export function requestFmdToolMetadata(apiClient: BrowserApiClient, url: string) {
  return apiClient.requestJson<{ error?: string; metadata?: FmdToolMetadataDraft }>("/api/tools/metadata", {
    method: "POST",
    json: { url },
  });
}

export function uploadFmdToolPreviewImageRequest(apiClient: BrowserApiClient, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiClient.requestForm<{ error?: string; imageUrl?: string; source?: FmdToolPreviewImageUpload["source"] }>("/api/tools/preview-image", formData);
}

export function updateNotificationStatusRequest(apiClient: BrowserApiClient, eventId: number, action: "seen" | "dismiss") {
  return apiClient.requestJson<{ error?: string }>(`/api/notifications/${eventId}`, {
    method: "PATCH",
    json: { action },
  });
}

export function createScoreObjectionRequest(apiClient: BrowserApiClient, sprintId: string, comment: string) {
  return apiClient.requestJson<{ error?: string; objection?: Parameters<typeof import("@/features/planning/model/planning-app-model").mapScoreObjectionResponse>[0] }>(`/api/sprints/${sprintId}/score-objections`, {
    method: "POST",
    json: { comment },
  });
}

export function reviewScoreObjectionRequest(apiClient: BrowserApiClient, sprintId: string, objectionId: number, input: ScoreObjectionResolutionInput) {
  return apiClient.requestJson<{
    error?: string;
    objection?: Parameters<typeof import("@/features/planning/model/planning-app-model").mapScoreObjectionResponse>[0];
    score?: Parameters<typeof import("@/lib/planning-sprint-mappers").mapFounderSprintScore>[0] | null;
  }>(`/api/sprints/${sprintId}/score-objections`, {
    method: "PATCH",
    json: { objectionId, ...input },
  });
}

export function lockSprintRequest(apiClient: BrowserApiClient, sprintId: string) {
  return apiClient.requestJson<{ error?: string; carryover?: { created?: number; evaluated?: number; nextSprintId?: string }; scoring?: { scores?: number; strikeEvents?: number; governanceReviews?: number } }>(`/api/sprints/${sprintId}/lock`, {
    method: "POST",
    json: {},
  });
}
