import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";
import type { CronWebhookHealth } from "@/lib/credentials/cron-types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type TerminalFailureReason = Readonly<{ reason: string; count: number }>;
type TerminalFailureReasons = Readonly<{
  planning: TerminalFailureReason[];
  comments: TerminalFailureReason[];
  projection: TerminalFailureReason[];
}>;
type TerminalFailureSummary = Readonly<{
  unresolved: TerminalFailureReasons;
  archived: TerminalFailureReasons;
}>;

function summarizeTerminalFailureReasons(rows: Array<{ reason?: string | null }>): TerminalFailureReason[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const reason = row.reason?.trim() || "unknown";
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => left.reason.localeCompare(right.reason));
}

function terminalFailureSummary(health: CronWebhookHealth): TerminalFailureSummary {
  const summarize = (values: Array<string | null>) => summarizeTerminalFailureReasons(values.map(reason => ({ reason })));
  return {
    unresolved: { planning: summarize(health.unresolved.planning), comments: summarize(health.unresolved.comments), projection: summarize(health.unresolved.projection) },
    archived: { planning: summarize(health.archived.planning), comments: summarize(health.archived.comments), projection: [] },
  };
}

function terminalFailureCount(reasons: TerminalFailureReason[]) {
  return reasons.reduce((total, reason) => total + reason.count, 0);
}

export async function GET(request: NextRequest) {
  const admission = await authorizeCredentialAction({ credential: { kind: "cron-request", request }, action: "github.webhooks.drain" });
  if (!admission.ok) return apiError(admission.error, admission.status);
  try {
    const deliveries = await admission.webhookDrain.run();
    const health = await admission.webhookDrain.health();
    const summary = terminalFailureSummary(health);
    const terminalFailureReasons = summary.unresolved;
    const archivedTerminalFailureReasons = summary.archived;
    const projectionTerminalFailed = terminalFailureCount(terminalFailureReasons.projection);
    const terminalFailed = terminalFailureCount(terminalFailureReasons.planning)
      + terminalFailureCount(terminalFailureReasons.comments)
      + projectionTerminalFailed;
    const archivedTerminalFailed = terminalFailureCount(archivedTerminalFailureReasons.planning)
      + terminalFailureCount(archivedTerminalFailureReasons.comments);
    const projectionDispatchFailed = deliveries.projection.failed;
    const unhealthy = terminalFailed > 0 || projectionDispatchFailed > 0;
    if (unhealthy) {
      console.error("GitHub webhook maintenance is unhealthy.", {
        terminalFailed,
        projectionDispatchFailed,
        terminalFailureReasons,
      });
    }
    return NextResponse.json({
      ok: !unhealthy,
      ...deliveries,
      projectionTerminalFailed,
      projectionDispatchFailed,
      projectionOutstanding: health.outstanding.projection,
      terminalFailed,
      terminalFailureReasons,
      archivedTerminalFailed,
      archivedTerminalFailureReasons,
      outstanding: health.outstanding.planning + health.outstanding.comments + health.outstanding.projection,
    }, { status: unhealthy ? 503 : 200 });
  } catch {
    return apiError("GitHub-Webhook-Ereignisse konnten nicht verarbeitet werden.", 500);
  }
}
