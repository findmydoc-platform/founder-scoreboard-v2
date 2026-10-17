import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { apiError, authzError } from "@/lib/api-response";
import { parsePlanningHeaderSlots } from "@/lib/planning-header-data";

export async function GET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning.header.read" });
  if (!permission.ok) return authzError(permission);
  const slots = parsePlanningHeaderSlots(request.nextUrl.searchParams.get("slots"));
  if (!slots) return apiError("Unknown planning header slot.", 400);
  const result = await permission.planning.loadHeader(slots);
  if (!result.ok) return authzError(result);
  return NextResponse.json({ headerData: result.headerData });
}
