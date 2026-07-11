import type { BrowserApiClient } from "@/lib/browser-api-client";

export type TeamIntakeTokenRecord = {
  id: string;
  label: string;
  tokenHint: string;
  scopes: string[];
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string;
  revokedAt: string;
};

type TokenListResponse = {
  ok?: boolean;
  error?: string;
  tokens?: TeamIntakeTokenRecord[];
};

type TokenCreateResponse = {
  ok?: boolean;
  error?: string;
  token?: string;
  tokenRecord?: TeamIntakeTokenRecord;
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
