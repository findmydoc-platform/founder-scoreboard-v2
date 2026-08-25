import { type NextRequest, NextResponse } from "next/server";
import {
  getOpenTeamWorkweekConflict,
  resolveTeamWorkweekConflict,
  TeamWorkweekConflictError,
} from "@/features/team-workweek/server/team-workweek-conflicts";
import { TeamWorkweekPublicationError } from "@/features/team-workweek/server/team-workweek-publication";
import { apiError, readJsonPayload, requireApiContext } from "@/lib/api-response";
import { bearerToken, requirePlanningContributor } from "@/lib/authz";
import { getSupabaseForToken } from "@/lib/supabase";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

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
  const context = await requireApiContext(request, requirePlanningContributor);
  if (!context.ok) return context.response;
  const ownerProfileId = context.permission.profile?.id;
  const serviceSupabase = getServerServiceRoleSupabase();
  if (!ownerProfileId) return apiError("Gebundenes Teamprofil erforderlich.", 403);
  if (!serviceSupabase) return apiError("Synchronisationskonflikt ist nicht verfügbar.", 503);
  try {
    return NextResponse.json({ conflict: await getOpenTeamWorkweekConflict(serviceSupabase, ownerProfileId) });
  } catch (error) {
    return conflictError(error);
  }
}

export async function POST(request: NextRequest) {
  const context = await requireApiContext(request, requirePlanningContributor);
  if (!context.ok) return context.response;
  const ownerProfileId = context.permission.profile?.id;
  const token = bearerToken(request);
  const userSupabase = token ? getSupabaseForToken(token) : null;
  const serviceSupabase = getServerServiceRoleSupabase();
  if (!ownerProfileId) return apiError("Gebundenes Teamprofil erforderlich.", 403);
  if (!userSupabase) return apiError("Anmeldung erforderlich.", 401);
  if (!serviceSupabase) return apiError("Synchronisationskonflikt ist nicht verfügbar.", 503);

  const payload = await readJsonPayload<unknown>(request, null);
  const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (Object.keys(input).some((key) => !["conflictId", "conflictRevision", "decision"].includes(key))
    || typeof input.conflictId !== "string" || !UUID_PATTERN.test(input.conflictId)
    || !Number.isInteger(input.conflictRevision) || Number(input.conflictRevision) < 1
    || (input.decision !== "founderops" && input.decision !== "google")) {
    return apiError("Gültige Konfliktentscheidung ist erforderlich.", 400);
  }

  try {
    const publication = await resolveTeamWorkweekConflict({
      conflictId: input.conflictId,
      conflictRevision: Number(input.conflictRevision),
      decision: input.decision,
      ownerProfileId,
      serviceSupabase,
      userSupabase,
    });
    return NextResponse.json({ publication }, { status: publication.status === "published" ? 200 : 202 });
  } catch (error) {
    return conflictError(error);
  }
}
