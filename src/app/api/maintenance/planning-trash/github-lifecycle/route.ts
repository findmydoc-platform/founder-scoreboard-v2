import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "maintenance-request", request }, action: "maintenance.planning-trash.lifecycle" });
  if (!permission.ok) return apiError(permission.error, permission.status);

  try {
    const lifecycle = await permission.planningTrash.drainLifecycle();
    const projection = await permission.planningTrash.dispatchProjection();
    const { terminalFailed, outstandingLifecycleJobs, outstandingProjectionRequests } = await permission.planningTrash.queueStatus();
    return NextResponse.json({
      ok: true,
      ...lifecycle,
      projection: {
        claimed: projection.claimed,
        completed: projection.completed,
        retryScheduled: projection.retryScheduled,
        failed: projection.failed,
      },
      terminalFailed,
      outstandingLifecycleJobs,
      outstandingProjectionRequests,
    });
  } catch {
    return apiError("GitHub-Lifecycle des Planungspapierkorbs konnte nicht verarbeitet werden.", 500);
  }
}
