import { type NextRequest, NextResponse } from "next/server";
import {
  publishTeamWorkweek,
  TeamWorkweekPublicationError,
} from "@/features/team-workweek/server/team-workweek-publication";
import { apiError, readJsonPayload, requireApiContext } from "@/lib/api-response";
import { bearerToken, requirePlanningContributor } from "@/lib/authz";
import { getSupabaseForToken } from "@/lib/supabase";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const context = await requireApiContext(request, requirePlanningContributor);
  if (!context.ok) return context.response;
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
    const publication = await publishTeamWorkweek({
      serviceSupabase,
      userSupabase,
      versionId: input.versionId,
    });
    return NextResponse.json({ publication }, { status: publication.syncState === "delayed" ? 202 : 200 });
  } catch (error) {
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
}
