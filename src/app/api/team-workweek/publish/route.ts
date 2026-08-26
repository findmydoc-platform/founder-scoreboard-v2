import { type NextRequest, NextResponse } from "next/server";
import {
  delayTeamWorkweekPublication,
  publishTeamWorkweek,
  TeamWorkweekPublicationError,
} from "@/features/team-workweek/server/team-workweek-publication";
import {
  detectTeamWorkweekParallelConflict,
  TeamWorkweekConflictError,
} from "@/features/team-workweek/server/team-workweek-conflicts";
import { requireTeamWorkweekStarterApiAccess } from "@/features/team-workweek/server/team-workweek-rollout-api";
import { apiError, readJsonPayload, requireApiContext } from "@/lib/api-response";
import { bearerToken, requirePlanningContributor } from "@/lib/authz";
import { getSupabaseForToken } from "@/lib/supabase";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function publicationFailureResponse(error: unknown) {
  if (!(error instanceof TeamWorkweekPublicationError)) {
    return apiError("Grundwoche konnte nicht veröffentlicht werden.", 503);
  }
  const status = error.code === "invalid_request"
    ? 400
    : error.code === "forbidden"
      ? 403
      : error.code === "not_found"
        ? 404
        : error.code === "conflict"
          ? 409
          : 503;
  return apiError(error.message, status);
}

export async function POST(request: NextRequest) {
  const context = await requireApiContext(request, requirePlanningContributor);
  if (!context.ok) return context.response;
  const rollout = await requireTeamWorkweekStarterApiAccess({
    actorProfileId: context.permission.profile?.id || "",
    actorRole: context.permission.profile?.platformRole,
  });
  if (!rollout.ok) return rollout.response;
  const token = bearerToken(request);
  const userSupabase = token ? getSupabaseForToken(token) : null;
  const serviceSupabase = getServerServiceRoleSupabase();
  if (!userSupabase) return apiError("Anmeldung erforderlich.", 401);
  if (!serviceSupabase) return apiError("Grundwoche kann derzeit nicht veröffentlicht werden.", 503);

  const payload = await readJsonPayload<unknown>(request, null);
  const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (Object.keys(input).some((key) => key !== "versionId") || typeof input.versionId !== "string" || !UUID_PATTERN.test(input.versionId)) {
    return apiError("Gültige private Wochenversion ist erforderlich.", 400);
  }

  try {
    const ownerProfileId = context.permission.profile?.id;
    if (!ownerProfileId) return apiError("Gebundenes Teamprofil erforderlich.", 403);
    const preflight = await detectTeamWorkweekParallelConflict({
      ownerProfileId,
      serviceSupabase,
      versionId: input.versionId,
    });
    if (preflight.state === "google_only") {
      return apiError("Google wurde geändert. Gleiche Google zuerst ab und prüfe danach deine private Version.", 409);
    }
    if (preflight.state === "conflict") {
      return NextResponse.json({
        error: "FounderOps und Google wurden parallel geändert. Wähle bewusst eine Variante.",
        conflict: preflight.conflict,
      }, { status: 409 });
    }
    const publication = await publishTeamWorkweek({
      serviceSupabase,
      userSupabase,
      versionId: input.versionId,
    });
    return NextResponse.json({ publication }, { status: publication.syncState === "delayed" ? 202 : 200 });
  } catch (error) {
    if (error instanceof TeamWorkweekConflictError) {
      if (error.delayClass) {
        try {
          const publication = await delayTeamWorkweekPublication({
            errorClass: error.delayClass,
            serviceSupabase,
            userSupabase,
            versionId: input.versionId,
          });
          return NextResponse.json({ publication }, { status: publication.syncState === "delayed" ? 202 : 200 });
        } catch (delayError) {
          return publicationFailureResponse(delayError);
        }
      }
      const status = error.code === "not_found" ? 404 : error.code === "forbidden" ? 403 : error.code === "stale" ? 409 : 503;
      return apiError(error.message, status);
    }
    return publicationFailureResponse(error);
  }
}
