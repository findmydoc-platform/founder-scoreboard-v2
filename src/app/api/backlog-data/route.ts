import { normalizeBacklogSupport } from "@/features/backlog/model/backlog-support";
import { normalizeBacklogSelection } from "@/features/backlog/model/backlog-selection";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";

export async function GET(request: NextRequest) {
  const apiContext = await requirePlanningContext(request, "planning.backlog.read");
  if (!apiContext.ok) return apiContext.response;
  const scope = request.nextUrl.searchParams.get("scope");
  let query;
  if (scope !== null) {
    if (scope.length > 16000) return apiError("Ungültige Backlog-Auswahl.", 400);
    try { const input = JSON.parse(scope); query = normalizeBacklogSelection(input) || normalizeBacklogSupport(input); } catch { return apiError("Ungültige Backlog-Auswahl.", 400); }
    if (!query) return apiError("Ungültige Backlog-Auswahl.", 400);
  }
  const result = await apiContext.planning.loadBacklog(query, { signal: request.signal });
  if (result.status === "forbidden") return apiError("Backlog darf nicht geladen werden.", 403);
  if (result.status === "staleContinuation") return apiError("Die Backlog-Grundlage hat sich geändert.", 409);
  if (result.status === "unavailable") return apiError("Backlog konnte nicht geladen werden.", 503);
  if (!query) return NextResponse.json({ model: result.model });
  const readAuthority = "readAuthority" in result ? result.readAuthority : undefined;
  const profile = apiContext.permission.profile;
  if (!readAuthority || readAuthority.deadline <= Date.now() || !profile) return apiError("Backlog darf nicht geladen werden.", 403);
  return NextResponse.json({ model: result.model, readAuthority, readActor: { profileId: profile.id, platformRole: profile.platformRole } }, { headers: { "cache-control": "no-store" } });
}
