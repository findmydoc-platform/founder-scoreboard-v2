import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import type { BrowserApiClient } from "@/lib/browser-api-client";

export function requestBacklogModel(apiClient: BrowserApiClient) {
  return apiClient.requestJson<{ error?: string; model?: BacklogModel }>("/api/backlog-data");
}
