"use client";

import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { DecisionTaskLink, FeedbackItem, FounderEvent, Meeting, MeetingAttendance, NotificationPreference, Package, PlanningDataResponse, Profile, ProfileFeatureTourAcknowledgement, ProfileUiPreference, ScoreObjection, Sprint, SprintCommitment, TaskFocusItem } from "@/lib/types";

export function requestPlanningData(apiClient: BrowserApiClient) {
  return apiClient.requestJson<Partial<PlanningDataResponse> & { error?: string }>("/api/planning-data");
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

export function linkDecisionTaskRequest(apiClient: BrowserApiClient, decisionId: number, payload: unknown) {
  return apiClient.requestJson<{ error?: string; link?: DecisionTaskLink }>(`/api/decisions/${decisionId}/tasks`, {
    method: "POST",
    json: payload,
  });
}

export function deleteDecisionTaskLinkRequest(apiClient: BrowserApiClient, decisionId: number, linkId: number) {
  return apiClient.requestJson<{ error?: string }>(`/api/decisions/${decisionId}/tasks?linkId=${encodeURIComponent(String(linkId))}`, {
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

export function createMeetingRequest(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<{ error?: string; meeting?: Meeting; attendance?: MeetingAttendance[]; calendarSync?: { status: "synced" | "skipped" | "failed"; htmlLink?: string; error?: string } }>("/api/meetings", {
    method: "POST",
    json: payload,
  });
}

export function updateMeetingRequest(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<{ error?: string; meeting?: Meeting }>("/api/meetings", {
    method: "PATCH",
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

export function availabilityRequest<T>(apiClient: BrowserApiClient, method: "POST" | "PATCH" | "DELETE", payload: unknown) {
  return apiClient.requestJson<T>("/api/availability", { method, json: payload });
}

export function syncGoogleCalendarRequest(apiClient: BrowserApiClient) {
  return apiClient.requestJson<{
    error?: string;
    ready?: boolean;
    skipped?: boolean;
    reason?: string;
    imported?: number;
    removed?: number;
    syncedAt?: string;
    availability?: import("@/lib/types").AvailabilityEntry[];
    results?: Array<{ profileId: string; email: string; imported: number; removed?: number; error?: string }>;
  }>("/api/calendar-sync", { method: "POST" });
}

export function createDecisionRequest(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<{ error?: string; decision?: import("@/lib/types").PlanningData["decisions"][number] }>("/api/decisions", {
    method: "POST",
    json: payload,
  });
}

export function confirmDecisionRequest(apiClient: BrowserApiClient, decisionId: number) {
  return apiClient.requestJson<{ error?: string; locked?: boolean; confirmedProfileIds?: string[] }>(`/api/decisions/${decisionId}/confirm`, {
    method: "POST",
    jsonContentType: false,
  });
}

export function updateDecisionRequest(apiClient: BrowserApiClient, decisionId: number, payload: unknown) {
  return apiClient.requestJson<{ error?: string; decision?: import("@/lib/types").PlanningData["decisions"][number] }>(`/api/decisions/${decisionId}`, {
    method: "PATCH",
    json: payload,
  });
}

export function objectDecisionRequest(apiClient: BrowserApiClient, decisionId: number, comment: string) {
  return apiClient.requestJson<{ error?: string; comment?: import("@/lib/types").PlanningData["decisionComments"][number] }>(`/api/decisions/${decisionId}/objections`, {
    method: "POST",
    json: { comment },
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

export function createFeedbackRequest(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<{ error?: string; feedback?: FeedbackItem }>("/api/feedback", {
    method: "POST",
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
