import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { apiError, authzError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning.board.read" });
  if (!permission.ok) return authzError(permission);
  const currentProfile = permission.profile;
  const [result, headerData] = await Promise.all([
    permission.planning.loadBoard(),
    permission.planning.loadHeader(currentProfile ? ["quickLinks", "calendarEvents"] : undefined),
  ]);
  if (result.status === "forbidden") return apiError("Planung darf nicht geladen werden.", 403);
  if (result.status === "unavailable") return apiError("Planung konnte nicht geladen werden.", 503);
  return NextResponse.json({ model: result.model, headerData, currentProfile });
}
