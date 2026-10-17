import type { NextRequest } from "next/server";
import type { GitHubWebhookDrainResult } from "../github-webhook-drain";

export type CronWebhookHealth = Readonly<{
  unresolved: Readonly<{ planning: Array<string | null>; comments: Array<string | null>; projection: Array<string | null> }>;
  archived: Readonly<{ planning: Array<string | null>; comments: Array<string | null>; projection: Array<string | null> }>;
  outstanding: Readonly<{ planning: number; comments: number; projection: number }>;
}>;
export type CronWebhookInput = {
  credential: { kind: "cron-request"; request: NextRequest };
  action: "github.webhooks.drain";
};
export type CronWebhookResult =
  | { ok: false; status: 401 | 501 | 503; error: string }
  | { ok: true; webhookDrain: Readonly<{ run(): Promise<GitHubWebhookDrainResult>; health(): Promise<CronWebhookHealth> }> };
