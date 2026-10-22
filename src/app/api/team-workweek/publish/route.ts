import { observeRuntimeHandler, observeRuntimePreparation } from "@/lib/runtime-logging";
import { type NextRequest, NextResponse } from "next/server";
import {
  TeamWorkweekPublicationError,
} from "@/features/team-workweek/server/team-workweek-publication";
import {
  TeamWorkweekConflictError,
} from "@/features/team-workweek/server/team-workweek-conflicts";
import { apiError, readJsonPayload } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";

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
  return observeRuntimePreparation(() => NextResponse.json({ error: error.message, code: error.code, ...(error.completionPending ? { completionPending: true } : {}) }, { status }));
}

async function handlePOST(request: NextRequest) {
  const payload = await readJsonPayload<unknown>(request, null);
  const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const context = await requirePlanningContext(request, "workweek.publish", typeof input.versionId === "string" ? input.versionId : "");
  if (!context.ok) return context.response;
  if (Object.keys(input).some((key) => key !== "versionId") || typeof input.versionId !== "string" || !UUID_PATTERN.test(input.versionId)) {
    return apiError("Gültige private Wochenversion ist erforderlich.", 400);
  }

  try {
    const preflight = await context.planning.detectWorkweekConflict();
    if (preflight.state === "google_only") {
      return apiError("Google wurde geändert. Gleiche Google zuerst ab und prüfe danach deine private Version.", 409);
    }
    if (preflight.state === "conflict") {
      return observeRuntimePreparation(() => NextResponse.json({
        error: "FounderOps und Google wurden parallel geändert. Wähle bewusst eine Variante.",
        conflict: preflight.conflict,
      }, { status: 409 }));
    }
    const publication = await context.planning.publishWorkweek();
    return observeRuntimePreparation(() => NextResponse.json({ publication }, { status: publication.syncState === "delayed" ? 202 : 200 }));
  } catch (error) {
    if (error instanceof TeamWorkweekConflictError) {
      if (error.delayClass) {
        try {
          const publication = await context.planning.delayWorkweek();
          return observeRuntimePreparation(() => NextResponse.json({ publication }, { status: publication.syncState === "delayed" ? 202 : 200 }));
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

export const POST = observeRuntimeHandler("workweek.publish", handlePOST);
