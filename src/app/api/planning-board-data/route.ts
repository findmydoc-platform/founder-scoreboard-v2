import { observeRuntimeHandler, observeRuntimePhase, observeRuntimePreparation } from "@/lib/runtime-logging";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { normalizePlanningBoardQuery, type PlanningBoardQueryInput } from "@/features/planning/model/planning-board-query";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { apiError, authzError } from "@/lib/api-response";

async function handleGET(request: NextRequest) {
  const permission = await observeRuntimePhase("board.authorization", () => authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning.board.read" }));
  if (!permission.ok) return authzError(permission);
  let query: PlanningBoardQueryInput | undefined;
  const rawQuery = request.nextUrl.searchParams.get("scope");
  if (rawQuery) {
    try {
      const parsed = JSON.parse(rawQuery);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || rawQuery.length > 16000 || (parsed.continuation && (typeof parsed.continuation !== "string" || parsed.continuation.length > 4096))) throw new Error("Invalid scope");
      query = parsed;
    } catch { return apiError("Ungültiger Planungsbereich.", 400); }
  }
  const currentProfile = permission.profile;
  const normalized = query && normalizePlanningBoardQuery(query);
  if (request.headers.get("accept")?.includes("application/x-ndjson") && query && !query.column && !query.continuation && normalized?.view === "board" && normalized.level === "deliverable") {
    const authority = permission.readAuthority;
    if (!authority || authority.deadline <= Date.now()) return apiError("Planung darf nicht geladen werden.", 403);
    const started = await permission.planning.startBoardQuery(query, { signal: request.signal });
    if (started.status === "forbidden") return apiError("Planung darf nicht geladen werden.", 403);
    if (started.status !== "ready") return apiError("Planung konnte nicht geladen werden.", 503);
    if (!started.delivery) return NextResponse.json({ model: started.model, readAuthority: authority, headerData: emptyPlanningHeaderData, currentProfile });
    const delivery = started.delivery, encoder = new TextEncoder();
    let cancelled = false, terminal = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (frame: import("@/features/planning/model/planning-board-delivery").PlanningBoardStreamFrame) => {
          if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
        };
        emit({ kind: "basis", readId: delivery.id, model: started.model, readAuthority: authority, currentProfile });
        await Promise.allSettled(Object.values(delivery.columns).map(async outcome => {
          let frame = await delivery.checkPublication(await outcome!);
          if (cancelled || terminal) return;
          if (authority.deadline <= Date.now()) frame = { kind: "failure", readId: delivery.id, status: 403, error: "Planung darf nicht geladen werden." };
          else if (frame.kind === "column" && frame.validUntil && Date.parse(frame.validUntil) <= Date.now()) frame = { kind: "failure", readId: delivery.id, status: 409, code: "stale_continuation", error: "Die Ergebnisliste hat sich geändert. Bitte erneut laden." };
          if (frame.kind === "failure" && frame.status !== 503) { terminal = true; delivery.abort(); }
          emit(frame);
        }));
        if (!cancelled) { emit({ kind: "end", readId: delivery.id }); controller.close(); }
      },
      cancel() { cancelled = true; delivery.abort(); },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", vary: "Accept", "x-content-type-options": "nosniff" } });
  }
  const result = await observeRuntimePhase("board.load", () => permission.planning.loadBoard(query, { signal: request.signal }));
  if (result.status === "forbidden") return apiError("Planung darf nicht geladen werden.", 403);
  if (result.status === "staleContinuation") return NextResponse.json({ error: "Die Ergebnisliste hat sich geändert. Bitte erneut laden.", code: "stale_continuation" }, { status: 409 });
  if (result.status === "unavailable") return apiError("Planung konnte nicht geladen werden.", 503);
  return observeRuntimePreparation(() => NextResponse.json({ model: result.model, readAuthority: permission.readAuthority, headerData: emptyPlanningHeaderData, currentProfile }));
}

export const GET = observeRuntimeHandler("planning.board", handleGET);
