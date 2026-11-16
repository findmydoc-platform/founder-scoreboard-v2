import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import type { BrowserApiClient } from "@/lib/browser-api-client";

export function requestBacklogModel(apiClient: BrowserApiClient) {
  return apiClient.requestJson<{ error?: string; model?: BacklogModel }>("/api/backlog-data");
}

export function requestBacklogSelection(apiClient: BrowserApiClient, query: import("./backlog-selection").BacklogSelectionQuery, signal?: AbortSignal) {
  return apiClient.requestJson<{ error?: string; model?: BacklogModel;
    readAuthority?: import("@/features/planning/model/planning-server-header-read").PlanningReadAuthority;
    readActor?: { profileId: string; platformRole: import("@/lib/types").Profile["platformRole"] };
  }>(`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify(query))}`, { signal });
}
