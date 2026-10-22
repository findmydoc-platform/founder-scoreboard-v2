import { observeRuntimeHandler, observeRuntimePreparation } from "@/lib/runtime-logging";
import { type NextRequest, NextResponse } from "next/server";
import {
  TeamWorkweekReconciliationError,
} from "@/features/team-workweek/server/team-workweek-reconciliation";
import { apiError, readJsonPayload } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";

export const dynamic = "force-dynamic";

async function handlePOST(request: NextRequest) {
  const context = await requirePlanningContext(request, "workweek.reconcile");
  if (!context.ok) return context.response;
  const payload = await readJsonPayload<unknown>(request, null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length) {
    return apiError("Google-Abgleich akzeptiert keine frei gewählten Ziele.", 400);
  }

  try {
    const reconciliation = await context.planning.reconcileWorkweek();
    return observeRuntimePreparation(() => NextResponse.json({ reconciliation }, {
      status: reconciliation.state === "delayed" ? 202 : reconciliation.state === "conflict" ? 409 : 200,
    }));
  } catch (error) {
    if (!(error instanceof TeamWorkweekReconciliationError)) {
      return apiError("Google-Abgleich konnte nicht abgeschlossen werden.", 503);
    }
    const status = error.code === "not_found" ? 404 : error.code === "forbidden" ? 403 : error.code === "conflict" ? 409 : 503;
    return apiError(error.message, status);
  }
}

export const POST = observeRuntimeHandler("workweek.reconcile", handlePOST);
