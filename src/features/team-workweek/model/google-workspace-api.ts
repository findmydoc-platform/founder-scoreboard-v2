import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { GoogleWorkspaceAdapter, GoogleWorkspaceRead, GoogleDisconnectRead, GoogleDisconnectConfirmation } from "./google-workspace-state";

export function googleWorkspaceApi(apiClient: BrowserApiClient): Required<GoogleWorkspaceAdapter> {
  return {
    async readGoogleWorkspace() { const { response, body } = await apiClient.requestJson<GoogleWorkspaceRead>("/api/google-workspace/status", { cache: "no-store", useDevProfileOverride: false }); return { status: response.status, value: body }; },
    async readGoogleDisconnect() { const { response, body } = await apiClient.requestJson<GoogleDisconnectRead>("/api/google-workspace/disconnect", { cache: "no-store", useDevProfileOverride: false }); return { status: response.status, value: body }; },
    async disconnectGoogleWorkspace() { const { response, body } = await apiClient.requestJson<GoogleDisconnectConfirmation>("/api/google-workspace/disconnect", { method: "POST", json: { confirm: true }, useDevProfileOverride: false }); return { status: response.status, value: body }; },
  };
}
