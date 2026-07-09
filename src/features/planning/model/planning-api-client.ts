"use client";

import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { FmdTool, FounderEvent, MeetingAttendance, NotificationPreference, Package, PlanningDataResponse, Profile, ProfileFeatureTourAcknowledgement, ProfileUiPreference, ScoreObjection, Sprint, SprintCommitment, TaskFocusItem } from "@/lib/types";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { FmdToolDraft } from "@/features/tools/model/fmd-tools";

type FmdToolPayload = FmdToolDraft & Pick<FmdTool, "status">;

export function requestPlanningData(apiClient: BrowserApiClient, workspace?: AppWorkspace) {
  const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : "";
  return apiClient.requestJson<Partial<PlanningDataResponse> & { error?: string }>(`/api/planning-data${query}`);
}

export function importDemoSeedRequest(apiClient: BrowserApiClient) {
  return apiClient.requestJson<{ error?: string; imported?: { profiles: number; packages: number; tasks: number; sprints: number; fmdTools: number; meetings: number } }>("/api/demo-seed/import", {
    method: "POST",
    jsonContentType: false,
  });
}

export function saveInitiativeRequest(apiClient: BrowserApiClient, draft: { id?: string }) {
  return apiClient.requestJson<{ error?: string; initiative?: Package }>(draft.id ? `/api/initiatives/${draft.id}` : "/api/initiatives", {
    method: draft.id ? "PATCH" : "POST",
    json: draft,
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
  return apiClient.requestJson<{ error?: string; profile?: Profile }>(`/api/profiles/${profileId}`, {
    method: "PATCH",
    json: payload,
  });
}

export function updateNotificationPreferenceRequest(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<{ error?: string; preference?: NotificationPreference }>("/api/notification-preferences", {
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

export function dismissNotificationRequest(apiClient: BrowserApiClient, eventId: number) {
  return apiClient.requestJson<{ error?: string }>(`/api/notifications/${eventId}`, {
    method: "PATCH",
    json: { status: "dismissed" },
  });
}

export function createScoreObjectionRequest(apiClient: BrowserApiClient, sprintId: string, comment: string) {
  return apiClient.requestJson<{ error?: string; objection?: Parameters<typeof import("@/features/planning/model/planning-app-model").mapScoreObjectionResponse>[0] }>(`/api/sprints/${sprintId}/score-objections`, {
    method: "POST",
    json: { comment },
  });
}

export function reviewScoreObjectionRequest(apiClient: BrowserApiClient, sprintId: string, objectionId: number, status: ScoreObjection["status"]) {
  return apiClient.requestJson<{ error?: string; objection?: Parameters<typeof import("@/features/planning/model/planning-app-model").mapScoreObjectionResponse>[0] }>(`/api/sprints/${sprintId}/score-objections`, {
    method: "PATCH",
    json: { objectionId, status, resolutionComment: status === "accepted" ? "Einwand angenommen." : "Einwand geprüft." },
  });
}

export function lockSprintRequest(apiClient: BrowserApiClient, sprintId: string) {
  return apiClient.requestJson<{ error?: string; carryover?: { created?: number; evaluated?: number; nextSprintId?: string }; scoring?: { scores?: number; strikeEvents?: number; governanceReviews?: number } }>(`/api/sprints/${sprintId}/lock`, {
    method: "POST",
    json: { finalizeNow: true },
  });
}
