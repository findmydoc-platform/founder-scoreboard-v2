import { type NextRequest, NextResponse } from "next/server";
import {
  TeamWorkweekConflictError,
} from "@/features/team-workweek/server/team-workweek-conflicts";
import { TeamWorkweekPublicationError } from "@/features/team-workweek/server/team-workweek-publication";
import { apiError, readJsonPayload } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function conflictError(error: unknown) {
  if (error instanceof TeamWorkweekConflictError) {
    const status = error.code === "not_found" ? 404 : error.code === "forbidden" ? 403 : error.code === "stale" ? 409 : 503;
    return apiError(error.message, status);
  }
  if (error instanceof TeamWorkweekPublicationError) {
    const status = error.code === "forbidden" ? 403 : error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 503;
    return apiError(error.message, status);
  }
  return apiError("Synchronisationskonflikt konnte nicht verarbeitet werden.", 503);
}

export async function GET(request: NextRequest) {
  const context = await requirePlanningContext(request, "workweek.conflict.read");
  if (!context.ok) return context.response;
  try {
    return NextResponse.json({ conflict: await context.planning.readWorkweekConflict() });
  } catch (error) {
    return conflictError(error);
  }
}

export async function POST(request: NextRequest) {
  const payload = await readJsonPayload<unknown>(request, null);
  const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const context = await requirePlanningContext(request, "workweek.conflict.resolve", typeof input.conflictId === "string" ? input.conflictId : "");
  if (!context.ok) return context.response;
  if (Object.keys(input).some((key) => !["conflictId", "conflictRevision", "decision"].includes(key))
    || typeof input.conflictId !== "string" || !UUID_PATTERN.test(input.conflictId)
    || !Number.isInteger(input.conflictRevision) || Number(input.conflictRevision) < 1
    || (input.decision !== "founderops" && input.decision !== "google")) {
    return apiError("Gültige Konfliktentscheidung ist erforderlich.", 400);
  }

  try {
    const publication = await context.planning.resolveWorkweekConflict(Number(input.conflictRevision), input.decision);
    return NextResponse.json({ publication }, { status: publication.status === "published" ? 200 : 202 });
  } catch (error) {
    return conflictError(error);
  }
}
