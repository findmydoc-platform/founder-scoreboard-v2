import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { TeamTaskIntakeTokenRecord } from "@/features/intake/model/team-task-intake-contract";

type TokenListResponse = {
  ok?: boolean;
  error?: string;
  tokens?: TeamTaskIntakeTokenRecord[];
};

type TokenCreateResponse = {
  ok?: boolean;
  error?: string;
  token?: string;
  tokenRecord?: TeamTaskIntakeTokenRecord;
};

export function loadTeamIntakeTokens(apiClient: BrowserApiClient) {
  return apiClient.requestJson<TokenListResponse>("/api/team/task-intake-tokens");
}

export function createTeamIntakeToken(apiClient: BrowserApiClient, label: string) {
  return apiClient.requestJson<TokenCreateResponse>("/api/team/task-intake-tokens", {
    method: "POST",
    json: { label },
  });
}

export function revokeTeamIntakeToken(apiClient: BrowserApiClient, tokenId: string) {
  return apiClient.requestJson<{ ok?: boolean; error?: string }>(`/api/team/task-intake-tokens/${tokenId}`, {
    method: "DELETE",
  });
}
