import { observeRuntimeHandler, observeRuntimePhase, observeRuntimePreparation } from "@/lib/runtime-logging";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { apiError, authzError } from "@/lib/api-response";

async function handleGET(request: NextRequest) {
  const permission = await observeRuntimePhase("board.authorization", () => authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning.board.read" }));
  if (!permission.ok) return authzError(permission);
  const currentProfile = permission.profile;
  const [result, header] = await Promise.all([
    observeRuntimePhase("board.load", () => permission.planning.loadBoard()),
    observeRuntimePhase("board.header", () => permission.planning.loadHeader(currentProfile ? ["quickLinks", "calendarEvents"] : undefined)),
  ]);
  if (!header.ok) return authzError(header);
  if (result.status === "forbidden") return apiError("Planung darf nicht geladen werden.", 403);
  if (result.status === "unavailable") return apiError("Planung konnte nicht geladen werden.", 503);
  return observeRuntimePreparation(() => NextResponse.json({ model: result.model, headerData: header.headerData, currentProfile }));
}

export const GET = observeRuntimeHandler("planning.board", handleGET);
