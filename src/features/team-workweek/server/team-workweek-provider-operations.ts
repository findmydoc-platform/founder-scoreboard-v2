import type { WorkweekPublicationBookkeeping } from "./team-workweek-bookkeeping";
import type { GoogleCalendarCapability } from "@/lib/credentials";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recoverGoogleWorkweekWrite, type PreparedWorkweekEffect, type WorkweekProviderWriteJournal } from "./team-workweek-immediate-effects";
import type { GoogleWorkweekSeriesResult } from "./team-workweek-publication-core";

export type WorkweekRecoveryReason = "in_progress" | "uncertain";
type ProviderFailure = Extract<GoogleWorkweekSeriesResult, { state: "delayed" }>["errorClass"];

export function providerWriteJournal(serviceSupabase: SupabaseClient, operationId: string, effectId: string, replay = false, bookkeeping?: WorkweekPublicationBookkeeping): WorkweekProviderWriteJournal {
  const record = async (state: "settled" | "uncertain" | "observed") => {
    const response = bookkeeping ? await bookkeeping.recordWrite(operationId, effectId, state) : await serviceSupabase.rpc("record_team_workweek_provider_write", {
      p_operation_id: operationId, p_effect_id: effectId, p_state: state,
    });
    if (response.error) throw new Error("Provider write evidence could not be recorded.");
  };
  return { target: {kind: "publication", operationId, targetId: effectId, replay}, outcome: record };
}

export async function finishProviderOperation(serviceSupabase: SupabaseClient, operationId: string, bookkeeping?: WorkweekPublicationBookkeeping) {
  const result = bookkeeping ? await bookkeeping.finish(operationId) : await serviceSupabase.rpc("finish_team_workweek_provider_operation", { p_operation_id: operationId });
  if (result.error) throw new Error("Provider operation could not be settled.");
  return result.data?.state === "settled";
}

type EffectRow = {
  id: string; google_event_id: string; generation: number; kind: string; operation: PreparedWorkweekEffect["operation"];
  payload: PreparedWorkweekEffect["payload"]; state: PreparedWorkweekEffect["state"]; confirmed_etag: string | null;
  expected_payload: PreparedWorkweekEffect["expectedPayload"]; expected_etag: string | null; instance_of: string | null;
  original_start: string | null; cleanup_at: string | null; cleanup_disposition: PreparedWorkweekEffect["cleanupDisposition"];
  cleanup_payload: PreparedWorkweekEffect["cleanupPayload"];
};

async function observeUncertainOperation(serviceSupabase: SupabaseClient, operationId: string, purpose: "publish" | "cleanup", accessToken: GoogleCalendarCapability, now: () => Date, abandon: boolean, recoverWrite: typeof recoverGoogleWorkweekWrite, bookkeeping?: WorkweekPublicationBookkeeping) {
  const writes = await serviceSupabase.from("team_workweek_provider_writes")
    .select("effect_id,team_workweek_publication_effects(*)").eq("operation_id", operationId)
    .in("state", ["dispatched", "uncertain"]);
  if (writes.error || !writes.data) return { settled: false, errorClass: "provider_unavailable" as const };
  for (const write of writes.data) {
    const row = write.team_workweek_publication_effects as unknown as EffectRow;
    const effect: PreparedWorkweekEffect = {
      id: row.id, calendarId: "primary", googleEventId: row.google_event_id, generation: row.generation,
      kind: row.kind, operation: row.operation, payload: row.payload, state: row.state, confirmedEtag: row.confirmed_etag,
      expectedPayload: row.expected_payload, expectedEtag: row.expected_etag, instanceOf: row.instance_of,
      originalStart: row.original_start, ...(row.cleanup_at ? { cleanupAt: row.cleanup_at } : {}),
      cleanupDisposition: row.cleanup_disposition, cleanupPayload: row.cleanup_payload,
    };
    bookkeeping?.preparedEffects([effect]);
    const observed = await recoverWrite({accessToken,effect,now,purpose,abandon,writeJournal:providerWriteJournal(serviceSupabase,operationId,effect.id,true,bookkeeping)});
    if (observed.state !== "confirmed") return { settled: false, errorClass: observed.errorClass };
  }
  return { settled: await finishProviderOperation(serviceSupabase, operationId, bookkeeping) };
}

export async function claimProviderOperation({ bookkeeping, serviceSupabase, publicationId, generation, purpose, accessToken, now = () => new Date(), recoverWrite = recoverGoogleWorkweekWrite }: {
  bookkeeping?: WorkweekPublicationBookkeeping;
  serviceSupabase: SupabaseClient; publicationId: string; generation: number; purpose: "publish" | "cleanup";
  accessToken: GoogleCalendarCapability; now?: () => Date; recoverWrite?: typeof recoverGoogleWorkweekWrite;
}): Promise<{ id: string; reason?: never } | { id?: never; reason: WorkweekRecoveryReason; errorClass?: ProviderFailure }> {
  const claim = () => bookkeeping ? bookkeeping.claim(purpose) : serviceSupabase.rpc("claim_team_workweek_provider_operation", {
    p_publication_id: publicationId, p_generation: generation, p_purpose: purpose,
  });
  let response = await claim();
  if (response.error) return { reason: "in_progress" };
  if (response.data?.state === "uncertain" && response.data.id) {
    const observation = await observeUncertainOperation(serviceSupabase, response.data.id, response.data.purpose, accessToken, now, Boolean(response.data.abandon), recoverWrite, bookkeeping);
    if (!observation.settled) return { reason: "uncertain", errorClass: observation.errorClass };
    response = await claim();
    if (response.error) return { reason: "in_progress" };
  }
  return response.data?.state === "claimed" && typeof response.data.id === "string"
    ? { id: response.data.id } : { reason: response.data?.state === "uncertain" ? "uncertain" : "in_progress" };
}
