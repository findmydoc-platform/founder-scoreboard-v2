import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureGoogleWorkweekSeries,
  ensureGoogleWorkweekSeriesTransition,
  type GoogleWorkweekSeriesResult,
  type PreparedWorkweekPublication,
} from "./team-workweek-publication-core";
import { discoverGoogleWorkweekInstance, ensureGoogleWorkweekEffect, recoverGoogleWorkweekWrite } from "./team-workweek-immediate-effects";
import { claimProviderOperation, finishProviderOperation, providerWriteJournal } from "./team-workweek-provider-operations";

export type WorkweekExecutionDelayClass = Extract<GoogleWorkweekSeriesResult, { state: "delayed" }>["errorClass"] | "storage_failed";

// Completion and delay belong to the application, but execute while the provider claim is held.
// Callers never construct operation IDs, write journals or effect confirmation evidence.
export async function executeTeamWorkweekPublication<Result>({
  serviceSupabase, publication, accessToken, complete, delayed,
  ensureEffect = ensureGoogleWorkweekEffect,
  discoverInstance = discoverGoogleWorkweekInstance,
  recoverWrite = recoverGoogleWorkweekWrite,
  ensureSeries = ensureGoogleWorkweekSeries,
  ensureTransition = ensureGoogleWorkweekSeriesTransition,
  now = () => new Date(),
  transitionsFirst = false,
}: {
  serviceSupabase: SupabaseClient;
  publication: PreparedWorkweekPublication;
  accessToken: string;
  complete: () => Promise<Result>;
  delayed: (errorClass: WorkweekExecutionDelayClass) => Promise<Result>;
  ensureEffect?: typeof ensureGoogleWorkweekEffect;
  discoverInstance?: typeof discoverGoogleWorkweekInstance;
  recoverWrite?: typeof recoverGoogleWorkweekWrite;
  ensureSeries?: typeof ensureGoogleWorkweekSeries;
  ensureTransition?: typeof ensureGoogleWorkweekSeriesTransition;
  now?: () => Date;
  transitionsFirst?: boolean;
}): Promise<Result> {
  if (publication.effects !== undefined) {
    const expired = () => !publication.effectiveAt || now().getTime() >= new Date(publication.effectiveAt).getTime();
    const claim = publication.writeJournalVersion !== undefined ? await claimProviderOperation({
      accessToken, publicationId: publication.id, generation: publication.attemptGeneration!, serviceSupabase, now, purpose: "publish", recoverWrite,
    }) : null;
    if (claim?.reason) return await delayed(claim.errorClass || "provider_unavailable");
    try {
      const syncEffect = async (effect: NonNullable<PreparedWorkweekPublication["effects"]>[number]): Promise<WorkweekExecutionDelayClass | null> => {
        if (expired()) return "provider_unavailable";
        if (effect.state === "confirmed") return null;
        if (effect.instanceOf && !effect.expectedEtag) {
          const observed = await discoverInstance({ accessToken, effect });
          if (observed.state === "delayed") return observed.errorClass;
          const bound = await serviceSupabase.rpc("bind_team_workweek_crossing_instance", {
            p_effect_id: effect.id, p_generation: effect.generation, p_event_id: observed.eventId,
            p_etag: observed.etag, p_original_payload: observed.originalPayload,
          });
          if (bound.error || !bound.data || bound.data.id !== effect.id) return "storage_failed";
          effect = bound.data;
        }
        const result = await ensureEffect({ accessToken, effect, now, ...(claim?.id ? { writeJournal: providerWriteJournal(serviceSupabase, claim.id, effect.id) } : {}) });
        if (result.state === "delayed") return result.errorClass;
        if (expired()) return "provider_unavailable";
        const confirmation = await serviceSupabase.rpc("confirm_team_workweek_effect", {
          p_effect_id: effect.id, p_generation: effect.generation, p_etag: result.etag, p_payload: effect.payload,
        });
        if (confirmation.error) return "storage_failed";
        return null;
      };
      const effects = publication.effects || [];
      const stages = [effects.filter((effect) => !effect.operation || effect.operation === "create"),
        effects.filter((effect) => effect.kind === "crossing_instance"),
        effects.filter((effect) => effect.operation && effect.operation !== "create" && effect.kind !== "crossing_instance")];
      for (const stage of stages) {
        for (let offset = 0; offset < stage.length; offset += 6) {
          const settled = await Promise.allSettled(stage.slice(offset, offset + 6).map(syncEffect));
          const results = settled.map((result) => result.status === "fulfilled" ? result.value : "storage_failed" as const);
          const failure = results.find((result) => result !== null);
          if (failure) return await delayed(failure);
        }
      }
      if (expired()) return await delayed("provider_unavailable");
      return await complete();
    } finally {
      if (claim?.id) await finishProviderOperation(serviceSupabase, claim.id);
    }
  }

  const syncSeries = async () => {
    let delayed: Extract<GoogleWorkweekSeriesResult, { state: "delayed" }> | null = null;
    for (const series of publication.series) {
      if (series.state === "confirmed") continue;
      let result: GoogleWorkweekSeriesResult;
      try {
        result = await ensureSeries({ accessToken, publication, series, now });
      } catch {
        result = { state: "delayed", errorClass: "provider_unavailable" };
      }
      if (result.state === "delayed") {
        delayed ??= result;
        continue;
      }
      const confirmation = await serviceSupabase.rpc("confirm_team_workweek_google_series", {
        p_series_id: series.id,
        p_etag: result.etag,
        p_founderops_revision: publication.publicationRevision,
        p_observed_at: result.observedAt,
      });
      if (confirmation.error) return "storage_failed" as const;
    }
    return delayed?.errorClass || null;
  };

  const syncTransitions = async () => {
    let delayed: Extract<GoogleWorkweekSeriesResult, { state: "delayed" }> | null = null;
    for (const transition of publication.transitions) {
      if (transition.state === "confirmed") continue;
      let result: GoogleWorkweekSeriesResult;
      try {
        result = await ensureTransition({ accessToken, transition, now });
      } catch {
        result = { state: "delayed", errorClass: "provider_unavailable" };
      }
      if (result.state === "delayed") {
        delayed ??= result;
        continue;
      }
      const confirmation = await serviceSupabase.rpc("confirm_team_workweek_google_series_transition", {
        p_transition_id: transition.id,
        p_etag: result.etag,
        p_expected_founderops_revision: transition.expectedFounderopsRevision,
        p_observed_at: result.observedAt,
      });
      if (confirmation.error) return "storage_failed" as const;
    }
    return delayed?.errorClass || null;
  };

  const stages = transitionsFirst ? [syncTransitions, syncSeries] : [syncSeries, syncTransitions];
  for (const sync of stages) {
    const errorClass = await sync();
    if (errorClass) return await delayed(errorClass);
  }

  return await complete();
}
