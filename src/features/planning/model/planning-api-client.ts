"use client";

import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { AuthenticatedProfile, FmdTool, FounderEvent, MeetingAttendance, NotificationPreference, PlanningHeaderData, Profile, ProfileFeatureTourAcknowledgement, ProfileUiPreference, ScoreObjectionResolutionInput, Sprint, Task, TaskFocusItem } from "@/lib/types";
import type { EpicNotEmptyError, EpicDeleteRequest } from "@/features/projects/model/epic-contract";
import type { FmdToolDraft, FmdToolMetadataDraft, FmdToolPreviewImageUpload } from "@/features/tools/model/fmd-tools";
import type { PlanningHeaderSlotKey } from "@/lib/planning-header-data";
import type { PlanningTaskRevision } from "@/features/planning/model/planning-revision";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import type { SupportingWorkspace, SupportingWorkspaceModel } from "@/features/planning/model/supporting-planning-shell-projection";
import type { SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";

type FmdToolPayload = FmdToolDraft & Pick<FmdTool, "status"> & { expectedUpdatedAt?: string };

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

export async function requestPlanningHeaderData(apiClient: BrowserApiClient, slots?: readonly PlanningHeaderSlotKey[], options: { signal?: AbortSignal } = {}) {
  const query = slots?.length ? `?slots=${encodeURIComponent(slots.join(","))}` : "";
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timeout = setTimeout(() => controller.abort(new DOMException("Header request timed out.", "TimeoutError")), 15_000);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([
      apiClient.requestJson<{ headerData?: PlanningHeaderData; error?: string }>(`/api/planning-header-data${query}`, { signal }),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}

export function deleteEpicRequest(apiClient: BrowserApiClient, epicId: string, payload: EpicDeleteRequest) {
  return apiClient.requestJson<{ task?: Partial<Task> & { id: string } } | EpicNotEmptyError | { error?: string; code?: string }>(
    `/api/tasks/${encodeURIComponent(epicId)}`,
    { method: "DELETE", json: payload },
  );
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
  return apiClient.requestJson<{ error?: string; code?: string; sprint?: Sprint }>(`/api/sprints/${sprintId}`, {
    method: "PATCH",
    json: payload,
  });
}

export function createSprintPlanRequest(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<{ error?: string; code?: string; sprints?: Sprint[] }>("/api/sprints", {
    method: "POST",
    json: payload,
  });
}

export function updateProfileRequest(apiClient: BrowserApiClient, profileId: string, payload: unknown) {
  return apiClient.requestJson<{ error?: string; code?: string; profile?: Partial<Profile>; notificationPreferences?: NotificationPreference[] }>(`/api/profiles/${profileId}`, {
    method: "PATCH",
    json: payload,
  });
}

export function updateOwnProfileSettingsRequest(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<{
    code?: string;
    error?: string;
    profile?: Profile;
    uiPreference?: ProfileUiPreference;
    notificationPreferences?: NotificationPreference[];
  }>("/api/profile-settings", {
    method: "PATCH",
    json: payload,
  });
}

export function updateSprintReviewWindowRequest(
  apiClient: BrowserApiClient,
  expectedReviewObjectionWindowHours: number,
  reviewObjectionWindowHours: number,
) {
  return apiClient.requestJson<{
    error?: string;
    code?: string;
    project?: { id: string; reviewObjectionWindowHours: number };
    sprints?: Array<{ id: string; reviewDueAt: string }>;
  }>("/api/sprints/review-window", {
    method: "PATCH",
    json: { expectedReviewObjectionWindowHours, reviewObjectionWindowHours },
  });
}

export function markProfileFeatureTourSeenRequest(apiClient: BrowserApiClient, tourId: string) {
  return apiClient.requestJson<{ error?: string; code?: string; acknowledgement?: ProfileFeatureTourAcknowledgement }>("/api/profile-feature-tours/seen", {
    method: "POST",
    json: { tourId },
  });
}

export function updateMeetingAttendanceRequest(apiClient: BrowserApiClient, meetingId: number, payload: unknown) {
  return apiClient.requestJson<{ error?: string; code?: string; warning?: string; effects?: "confirmed" | "unconfirmed"; attendance?: MeetingAttendance }>(`/api/meetings/${meetingId}/attendance`, {
    method: "POST",
    json: payload,
  });
}

export function createFounderEventRequest(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<{ error?: string; code?: string; warning?: string; event?: FounderEvent }>("/api/events", {
    method: "POST",
    json: payload,
  });
}

export function updateFounderEventRequest(apiClient: BrowserApiClient, eventId: number, payload: unknown) {
  return apiClient.requestJson<{ error?: string; code?: string; warning?: string; event?: FounderEvent }>(`/api/events/${eventId}`, {
    method: "PATCH",
    json: payload,
  });
}

export function createFmdToolRequest(apiClient: BrowserApiClient, payload: FmdToolPayload) {
  return apiClient.requestJson<{ error?: string; code?: string; warning?: string; tool?: FmdTool }>("/api/tools", {
    method: "POST",
    json: payload,
  });
}

export function updateFmdToolRequest(apiClient: BrowserApiClient, toolId: string, payload: FmdToolPayload) {
  return apiClient.requestJson<{ error?: string; code?: string; warning?: string; tool?: FmdTool }>(`/api/tools/${encodeURIComponent(toolId)}`, {
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

export function uploadFmdToolPreviewImageRequest(apiClient: BrowserApiClient, file: File, expectedSession?: Pick<import("@/lib/credentials/browser").BrowserSessionSnapshot, "userId" | "revision">) {
  const formData = new FormData();
  formData.append("file", file);
  return apiClient.requestForm<{ error?: string; code?: string; imageUrl?: string; source?: FmdToolPreviewImageUpload["source"] }>("/api/tools/preview-image", formData, { expectedSession });
}

export function updateNotificationStatusRequest(apiClient: BrowserApiClient, eventId: number, action: "seen" | "dismiss") {
  return apiClient.requestJson<{ ok?: boolean; action?: "seen" | "dismiss"; status?: import("@/lib/types").NotificationEvent["status"]; error?: string; code?: string }>(`/api/notifications/${eventId}`, {
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

export function lockSprintRequest(apiClient: BrowserApiClient, sprintId: string, payload: unknown) {
  return apiClient.requestJson<Partial<import("@/features/sprint/model/sprint-lock").SprintLockReceipt> & { error?: string; code?: string }>(`/api/sprints/${sprintId}/lock`, { method: "POST", json: payload });
}
export function requestSprintLock(apiClient: BrowserApiClient, sprintId: string) {
  return apiClient.requestJson<Partial<import("@/features/sprint/model/sprint-lock").SprintLockObservation> & { error?: string; code?: string }>(`/api/sprints/${sprintId}/lock`);
}
