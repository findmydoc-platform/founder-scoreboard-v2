import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PrivateWorkweekAdapter, PrivateWorkweekContext, PrivateWorkweekPublicationConfirmation, PrivateWorkweekSaveConfirmation, WorkweekReconciliationConfirmation, WorkweekConflictRead, WorkweekConflictConfirmation } from "./private-workweek-planning-state";

export function privateWorkweekApi(apiClient: BrowserApiClient): Required<PrivateWorkweekAdapter> {
  return {
    async readWorkweekConflict() {
      const { response, body } = await apiClient.requestJson<WorkweekConflictRead>("/api/team-workweek/conflict", { cache: "no-store", useDevProfileOverride: false });
      return { status: response.status, value: body };
    },
    async resolveWorkweekConflict(input) {
      const { response, body } = await apiClient.requestJson<WorkweekConflictConfirmation>("/api/team-workweek/conflict", { method: "POST", json: input, useDevProfileOverride: false });
      return { status: response.status, value: body };
    },
    async reconcilePrivateWorkweek() {
      const { response, body } = await apiClient.requestJson<WorkweekReconciliationConfirmation>("/api/team-workweek/reconcile", { method: "POST", json: {}, useDevProfileOverride: false });
      return { status: response.status, value: body };
    },
    async readPrivateWorkweek(week) {
      const query = week ? `?week=${encodeURIComponent(week)}` : "";
      const { response, body } = await apiClient.requestJson<PrivateWorkweekContext>(`/api/team-workweek/private-draft${query}`, { cache: "no-store", useDevProfileOverride: false });
      return { status: response.status, value: body };
    },
    async savePrivateWorkweek(input) {
      const { response, body } = await apiClient.requestJson<PrivateWorkweekSaveConfirmation>("/api/team-workweek/private-draft", { method: "POST", json: input, useDevProfileOverride: false });
      return { status: response.status, value: body };
    },
    async publishPrivateWorkweek(versionId) {
      const { response, body } = await apiClient.requestJson<PrivateWorkweekPublicationConfirmation>("/api/team-workweek/publish", { method: "POST", json: { versionId }, useDevProfileOverride: false });
      return { status: response.status, value: body };
    },
  };
}
