import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import type { BrowserApiClient } from "@/lib/browser-api-client";

export function requestBacklogModel(apiClient: BrowserApiClient) {
  return apiClient.requestJson<{ error?: string; model?: BacklogModel }>("/api/backlog-data");
}

type ScopedBacklogResponse = { error?: string; model?: BacklogModel;
  readAuthority?: import("@/features/planning/model/planning-server-header-read").PlanningReadAuthority;
  readActor?: { profileId: string; platformRole: import("@/lib/types").Profile["platformRole"] };
};
function requestScopedBacklog(apiClient: BrowserApiClient, query: import("./backlog-selection").BacklogSelectionQuery | import("./backlog-support").BacklogSupportQuery | import("./backlog-rank-target").BacklogRankQuery, signal?: AbortSignal) {
  return apiClient.requestJson<ScopedBacklogResponse>(`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify(query))}`, { signal });
}
export function requestBacklogSelection(apiClient: BrowserApiClient, query: import("./backlog-selection").BacklogSelectionQuery, signal?: AbortSignal) {
  return requestScopedBacklog(apiClient, query, signal);
}
export function requestBacklogSupport(apiClient: BrowserApiClient, query: import("./backlog-support").BacklogSupportQuery, signal?: AbortSignal) {
  return requestScopedBacklog(apiClient, query, signal);
}
export function requestBacklogRankTarget(apiClient: BrowserApiClient, query: import("./backlog-rank-target").BacklogRankQuery, signal?: AbortSignal) {
  return requestScopedBacklog(apiClient, query, signal);
}
