import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { TeamPlanningItemTokenRecord } from "@/features/planning-items/model/planning-items-contract";

type TokenListResponse = {
  ok?: boolean;
  error?: string;
  tokens?: TeamPlanningItemTokenRecord[];
  capabilities?: {
    canIssueEmptyMilestoneDeletes?: boolean;
  };
};

type TokenCreateResponse = {
  ok?: boolean;
  error?: string;
  token?: string;
  tokenRecord?: TeamPlanningItemTokenRecord;
};

const tokensEndpoint = "/api/team/planning-items/v1/tokens";

export function loadPlanningItemsTokens(apiClient: BrowserApiClient) {
  return apiClient.requestJson<TokenListResponse>(tokensEndpoint);
}

export function createPlanningItemsToken(
  apiClient: BrowserApiClient,
  label: string,
  allowUpdates: boolean,
  allowEmptyMilestoneDeletes: boolean,
) {
  return apiClient.requestJson<TokenCreateResponse>(tokensEndpoint, {
    method: "POST",
    json: { label, allowUpdates, allowEmptyMilestoneDeletes },
  });
}

export function revokePlanningItemsToken(apiClient: BrowserApiClient, tokenId: string) {
  return apiClient.requestJson<{ ok?: boolean; error?: string }>(`${tokensEndpoint}/${tokenId}`, {
    method: "DELETE",
  });
}
