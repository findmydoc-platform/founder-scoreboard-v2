import { observeRuntimeHandler, observeRuntimePreparation } from "@/lib/runtime-logging";
import { NextResponse, type NextRequest } from "next/server";
import { apiError, authzError } from "@/lib/api-response";
import { parseSprintScopedQuery } from "@/features/sprint/model/sprint-scoped-read";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";

const assessmentFailures = {
  forbidden: { status: 403, code: "sprint_assessment_denied", error: "Sprint-Bewertung darf nicht geladen werden." },
  notFound: { status: 404, code: "sprint_assessment_not_found", error: "Sprint wurde nicht gefunden." },
  stale: { status: 409, code: "stale_sprint_assessment", error: "Die Grundlage der Sprint-Bewertung wurde geändert." },
  unavailable: { status: 503, code: "sprint_assessment_unavailable", error: "Sprint-Bewertung konnte nicht vollständig geprüft werden." },
} as const;

async function handleGET(request: NextRequest) {
  const apiContext = await requirePlanningContext(request, "planning.sprint.read");
  if (!apiContext.ok) return apiContext.response;
  const params = request.nextUrl.searchParams;
  const area = params.get("area");
  if (area === "assessment" || area === "assessment-source") {
    const sprintId = params.get("sprintId")?.trim();
    if (!sprintId || sprintId.length > 256 || params.getAll("area").length !== 1 || params.getAll("sprintId").length !== 1
      || Array.from(params.keys()).some(key => key !== "area" && key !== "sprintId")) return apiError("Ungültige Bewertung des Sprints.", 400);
    const result = area === "assessment"
      ? await apiContext.planning.loadSprintAssessment(sprintId, request.signal)
      : await apiContext.planning.observeSprintAssessment(sprintId, request.signal);
    const headers = { "Cache-Control": "private, no-store" };
    if (result.status !== "ready") {
      const { status, code, error } = assessmentFailures[result.status];
      return NextResponse.json({ code, error }, { status, headers });
    }
    return observeRuntimePreparation(() => NextResponse.json(result.read, { headers }));
  }
  if (params.has("scope") || params.has("projection") || params.has("basis") || params.has("selectedBasis")) {
    const query = parseSprintScopedQuery(params);
    const selectedBasis = params.get("selectedBasis");
    if (!query || selectedBasis !== null && (query.scope !== "assignment" || !!query.continuation || !selectedBasis || selectedBasis.length > 4096)) {
      return apiError("Ungültige Sprint-Abfrage.", 400);
    }
    if (params.has("projection") || params.has("basis")) {
      const basis = params.get("basis");
      if (query.scope !== "selected" || !query.sprintId || params.get("projection") !== "matches"
        || !basis || basis.length > 4096) return apiError("Ungültige Sprint-Abfrage.", 400);
      const result = await apiContext.planning.loadSprintSelectedProjection(query, basis, { signal: request.signal });
      if (result.status === "forbidden") return apiError("Sprint darf nicht geladen werden.", 403);
      if (result.status === "staleSelectionBasis") return NextResponse.json({ error: "Die Sprint-Daten wurden geändert.", code: "stale_selection_basis" }, { status: 409 });
      if (result.status !== "ready") return apiError("Sprint-Filter konnten nicht geladen werden.", 503);
      return observeRuntimePreparation(() => NextResponse.json(result.read, { headers: { "Cache-Control": "private, no-store" } }));
    }
    const result = await apiContext.planning.loadSprintScope(query, { signal: request.signal, ...(selectedBasis ? { selectedBasis } : {}) });
    if (result.status === "forbidden") return apiError("Sprint darf nicht geladen werden.", 403);
    if (result.status === "notFound") return apiError("Sprint wurde nicht gefunden.", 404);
    if (result.status === "staleContinuation") return NextResponse.json({ error: "Die Sprint-Daten wurden geändert.", code: "stale_continuation" }, { status: 409 });
    if (result.status !== "ready") return apiError("Sprint konnte nicht geladen werden.", 503);
    const { page, model, selectionBasis, selected, readAuthority, readActor } = result;
    return observeRuntimePreparation(() => NextResponse.json({ page, ...(model ? { model } : {}), ...(selectionBasis ? { selectionBasis } : {}), ...(selected ? { selected } : {}), readAuthority, readActor },
      { headers: { "Cache-Control": "private, no-store" } }));
  }
  const currentProfile = apiContext.permission.profile;
  const [result, header] = await Promise.all([
    apiContext.planning.loadSprint(), apiContext.planning.loadHeader(request.nextUrl.searchParams.get("header") === "independent" ? ["quickLinks", "calendarEvents"] : undefined),
  ]);
  if (!header.ok) return authzError(header);
  if (result.status === "forbidden") return apiError("Sprint darf nicht geladen werden.", 403);
  if (result.status === "unavailable") return apiError("Sprint konnte nicht geladen werden.", 503);
  return observeRuntimePreparation(() => NextResponse.json({ model: result.model, headerData: header.headerData, currentProfile }));
}

export const GET = observeRuntimeHandler("planning.sprint", handleGET);
