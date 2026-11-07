import { observeRuntimeHandler, observeRuntimePhase, observeRuntimePreparation } from "@/lib/runtime-logging";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import type { PlanningBoardQueryInput } from "@/features/planning/model/planning-board-query";
import { apiError, authzError } from "@/lib/api-response";

async function handleGET(request: NextRequest) {
  const permission = await observeRuntimePhase("board.authorization", () => authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning.board.read" }));
  if (!permission.ok) return authzError(permission);
  let query: PlanningBoardQueryInput = {};
  const rawQuery = request.nextUrl.searchParams.get("scope");
  if (rawQuery) {
    try {
      const parsed = JSON.parse(rawQuery);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || rawQuery.length > 16000 || (parsed.continuation && (typeof parsed.continuation !== "string" || parsed.continuation.length > 4096))) throw new Error("Invalid scope");
      query = parsed;
    } catch { return apiError("Ungültiger Planungsbereich.", 400); }
  }
  const currentProfile = permission.profile;
  const [result, header] = await Promise.all([
    observeRuntimePhase("board.load", () => permission.planning.loadBoard(query)),
    observeRuntimePhase("board.header", () => permission.planning.loadHeader(currentProfile ? ["quickLinks", "calendarEvents"] : undefined)),
  ]);
  if (!header.ok) return authzError(header);
  if (result.status === "forbidden") return apiError("Planung darf nicht geladen werden.", 403);
  if (result.status === "staleContinuation") return NextResponse.json({ error: "Die Ergebnisliste hat sich geändert. Bitte erneut laden.", code: "stale_continuation" }, { status: 409 });
  if (result.status === "unavailable") return apiError("Planung konnte nicht geladen werden.", 503);
  return observeRuntimePreparation(() => NextResponse.json({ model: result.model, headerData: header.headerData, currentProfile }));
}

export const GET = observeRuntimeHandler("planning.board", handleGET);
