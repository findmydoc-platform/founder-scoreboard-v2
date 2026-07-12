import { NextResponse, type NextRequest } from "next/server";
import type { TeamTaskIntakeScope } from "@/features/intake/model/team-task-intake-contract";
import {
  requireTeamTaskIntakeScope,
  type TeamTaskIntakeAuthResult,
} from "@/features/intake/model/team-task-intake-token";

type SuccessfulTeamTaskIntakeAuth = Extract<TeamTaskIntakeAuthResult, { ok: true }>;

type TeamTaskIntakeHandler = (permission: SuccessfulTeamTaskIntakeAuth) => Promise<Response>;

export function teamTaskIntakeJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function teamTaskIntakeError(error: string, status: number) {
  return teamTaskIntakeJson({ ok: false, error }, status);
}

function publicCommitError(error: unknown, fallbackError: string) {
  const code = error instanceof Error && "code" in error ? String(error.code || "") : "";
  if (code === "P0003") return teamTaskIntakeError("Idempotency-Key wurde mit anderen Daten wiederverwendet.", 409);
  if (code === "P0004") return teamTaskIntakeError("Team-Intake-Token ist nicht mehr aktiv.", 401);
  if (code === "P0005" || code === "P0006") return teamTaskIntakeError("Team-Intake-Berechtigung ist nicht mehr gültig.", 403);
  if (code === "P0002" || code === "22023") return teamTaskIntakeError("Team-Intake-Batch ist ungültig.", 400);
  if (code === "PGRST202" || code === "42P01" || code === "42703" || code === "42883") {
    return teamTaskIntakeError("Team-Intake-Schema ist noch nicht verfügbar.", 503);
  }
  return teamTaskIntakeError(fallbackError, 500);
}

export async function handleTeamTaskIntakeRequest(
  request: NextRequest,
  scope: TeamTaskIntakeScope,
  fallbackError: string,
  handler: TeamTaskIntakeHandler,
) {
  const permission = await requireTeamTaskIntakeScope(request, scope);
  if (!permission.ok) return teamTaskIntakeError(permission.error, permission.status);

  try {
    return await handler(permission);
  } catch (error) {
    return publicCommitError(error, fallbackError);
  }
}
