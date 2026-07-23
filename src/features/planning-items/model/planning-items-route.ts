import { NextResponse, type NextRequest } from "next/server";
import type { TeamPlanningItemScope } from "@/features/planning-items/model/planning-items-contract";
import {
  requireTeamPlanningItemScope,
  type TeamPlanningItemsAuthResult,
} from "@/features/planning-items/model/planning-items-token";

type SuccessfulPlanningItemsAuth = Extract<TeamPlanningItemsAuthResult, { ok: true }>;
type PlanningItemsHandler = (permission: SuccessfulPlanningItemsAuth) => Promise<Response>;

export function planningItemsJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function planningItemsError(error: string, status: number) {
  return planningItemsJson({ ok: false, error }, status);
}

function publicCommitError(error: unknown, fallbackError: string) {
  const code = error instanceof Error && "code" in error ? String(error.code || "") : "";
  if (code === "P0001") return planningItemsError("Planungselement wurde zwischenzeitlich geändert. Bitte erneut laden.", 409);
  if (code === "P0002") return planningItemsError("Planungselement wurde nicht gefunden.", 404);
  if (code === "P0003") return planningItemsError("Idempotency-Key wurde mit anderen Daten wiederverwendet.", 409);
  if (["P0008", "P0010"].includes(code)) return planningItemsError("Statusübergang ist wegen eines zwischenzeitlich geänderten Planungs- oder Review-Zustands nicht mehr zulässig.", 409);
  if (code === "P0004") return planningItemsError("Planning-API-Token ist nicht mehr aktiv.", 401);
  if (["P0005", "P0006", "P0007"].includes(code)) return planningItemsError("Planning-API-Berechtigung ist nicht mehr gültig.", 403);
  if (code === "22023") return planningItemsError("Planning-Items-Anfrage ist ungültig.", 400);
  if (["PGRST202", "42P01", "42703", "42883"].includes(code)) {
    return planningItemsError("Planning-API-Schema ist noch nicht verfügbar.", 503);
  }
  return planningItemsError(fallbackError, 500);
}

export async function handlePlanningItemsRequest(
  request: NextRequest,
  scope: TeamPlanningItemScope,
  fallbackError: string,
  handler: PlanningItemsHandler,
) {
  const permission = await requireTeamPlanningItemScope(request, scope);
  if (!permission.ok) return planningItemsError(permission.error, permission.status);

  try {
    return await handler(permission);
  } catch (error) {
    return publicCommitError(error, fallbackError);
  }
}
