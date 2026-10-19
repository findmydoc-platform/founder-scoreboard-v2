import type { NextRequest } from "next/server";
import type { GitHubWebhookDeliveryRecord } from "../github-webhook-intake";
export type GitHubWebhookInput = {
  credential: {
    kind: "github-webhook-request";
    request: NextRequest;
  };
  action: "github.webhook.accept";
};
export type GitHubWebhookResult = {
  kind: "ping";
} | {
  kind: "ignored";
} | {
  kind: "rejected";
  status: 400 | 401 | 403 | 409 | 413 | 415 | 503;
  code: string;
  message: string;
} | {
  kind: "accepted";
  duplicate: boolean;
  delivery: GitHubWebhookDeliveryRecord;
  dispatch(): Promise<void>;
};
