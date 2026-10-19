import type { WorkweekPublicationBookkeeping } from "./team-workweek-bookkeeping";
import type { GoogleCalendarCapability } from "@/lib/credentials";
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureGoogleWorkweekSeries,
  ensureGoogleWorkweekSeriesTransition,
  type GoogleWorkweekSeriesResult,
  type PreparedWorkweekPublication,
} from "./team-workweek-publication-core";
import { cleanupGoogleWorkweekEffect, discoverGoogleWorkweekInstance, ensureGoogleWorkweekEffect, recoverGoogleWorkweekWrite, type PreparedWorkweekEffect } from "./team-workweek-immediate-effects";
import { claimProviderOperation, finishProviderOperation, providerWriteJournal, type WorkweekRecoveryReason } from "./team-workweek-provider-operations";

export type WorkweekExecutionDelayClass = Extract<GoogleWorkweekSeriesResult, { state: "delayed" }>["errorClass"] | "storage_failed";

type ExecutionContext = Readonly<{
  bookkeeping?: WorkweekPublicationBookkeeping;
  serviceSupabase: SupabaseClient;
  accessToken: GoogleCalendarCapability;
  now: () => Date;
}>;

async function withProviderOperation<Result>({
  bookkeeping, serviceSupabase, accessToken, now, publicationId, generation, purpose, journaled, recoverWrite,
}: ExecutionContext & {
  publicationId: string;
  generation: number;
  purpose: "publish" | "cleanup";
  journaled: boolean;
  recoverWrite: typeof recoverGoogleWorkweekWrite;
}, execute: (operationId?: string) => Promise<Result>,
blocked: (errorClass: WorkweekExecutionDelayClass, reason: WorkweekRecoveryReason) => Promise<Result>): Promise<Result> {
  const claim = journaled ? await claimProviderOperation({
    bookkeeping, serviceSupabase, accessToken, now, publicationId, generation, purpose, recoverWrite,
  }) : null;
  if (claim?.reason) return await blocked(claim.errorClass || "provider_unavailable", claim.reason);
  try {
    return await execute(claim?.id);
  } finally {
    if (claim?.id) await finishProviderOperation(serviceSupabase, claim.id, bookkeeping);
  }
}

async function bindCrossingInstance({ serviceSupabase, accessToken, discoverInstance }: {
  bookkeeping?: WorkweekPublicationBookkeeping;
  serviceSupabase: SupabaseClient;
  accessToken: GoogleCalendarCapability;
  discoverInstance: typeof discoverGoogleWorkweekInstance;
}, effect: PreparedWorkweekEffect): Promise<PreparedWorkweekEffect | WorkweekExecutionDelayClass> {
  const observed = await discoverInstance({ accessToken, effect });
  if (observed.state === "delayed") return observed.errorClass;
  const bound = await serviceSupabase.rpc("bind_team_workweek_crossing_instance", {
    p_effect_id: effect.id, p_generation: effect.generation, p_event_id: observed.eventId,
    p_etag: observed.etag, p_original_payload: observed.originalPayload,
  });
  return bound.error || bound.data?.id !== effect.id ? "storage_failed" : bound.data;
}

type ConfirmedEffect = Extract<GoogleWorkweekSeriesResult, { state: "confirmed" }> & { preserved?: boolean };

async function mutateAndConfirmEffect({
  bookkeeping, serviceSupabase, accessToken, now, operationId, effect, mutate, confirm,
}: ExecutionContext & {
  operationId?: string;
  effect: PreparedWorkweekEffect;
  mutate: typeof ensureGoogleWorkweekEffect;
  confirm: (result: ConfirmedEffect) => Promise<WorkweekExecutionDelayClass | null>;
}): Promise<WorkweekExecutionDelayClass | null> {
  const result = await mutate({ accessToken, effect, now,
    ...(operationId ? { writeJournal: providerWriteJournal(serviceSupabase, operationId, effect.id, false, bookkeeping) } : {}),
  });
  return result.state === "delayed" ? result.errorClass : await confirm(result);
}

// Completion and delay belong to the application, but execute while the provider claim is held.
// Callers never construct operation IDs, write journals or effect confirmation evidence.
export async function executeTeamWorkweekPublication<Result>({
  bookkeeping, serviceSupabase, publication, accessToken, complete, delayed,
  ensureEffect = ensureGoogleWorkweekEffect,
  discoverInstance = discoverGoogleWorkweekInstance,
  recoverWrite = recoverGoogleWorkweekWrite,
  ensureSeries = ensureGoogleWorkweekSeries,
  ensureTransition = ensureGoogleWorkweekSeriesTransition,
  now = () => new Date(),
  transitionsFirst = false,
}: {
  bookkeeping?: WorkweekPublicationBookkeeping;
  serviceSupabase: SupabaseClient;
  publication: PreparedWorkweekPublication;
  accessToken: GoogleCalendarCapability;
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
    return await withProviderOperation({
      accessToken, publicationId: publication.id, generation: publication.attemptGeneration!, serviceSupabase, bookkeeping, now,
      purpose: "publish", journaled: publication.writeJournalVersion !== undefined, recoverWrite,
    }, async operationId => {
      const syncEffect = async (effect: NonNullable<PreparedWorkweekPublication["effects"]>[number]): Promise<WorkweekExecutionDelayClass | null> => {
        if (expired()) return "provider_unavailable";
        if (effect.state === "confirmed") return null;
        if (effect.instanceOf && !effect.expectedEtag) {
          const bound = await bindCrossingInstance({ serviceSupabase, accessToken, discoverInstance }, effect);
          if (typeof bound === "string") return bound;
          effect = bound;
        }
        return await mutateAndConfirmEffect({ bookkeeping, serviceSupabase, accessToken, now, operationId, effect,
          mutate: ensureEffect,
          confirm: async result => {
            if (expired()) return "provider_unavailable";
            const confirmation = bookkeeping ? await bookkeeping.confirmEffect(effect.id, effect.generation, result.etag, effect.payload) : await serviceSupabase.rpc("confirm_team_workweek_effect", {
              p_effect_id: effect.id, p_generation: effect.generation, p_etag: result.etag, p_payload: effect.payload,
            });
            return confirmation.error ? "storage_failed" : null;
          },
        });
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
    }, async errorClass => await delayed(errorClass));
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
      const confirmation = bookkeeping ? await bookkeeping.confirmSeries(series.id, result.etag, result.observedAt) : await serviceSupabase.rpc("confirm_team_workweek_google_series", {
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
      const confirmation = bookkeeping ? await bookkeeping.confirmTransition(transition.id, result.etag, transition.expectedFounderopsRevision, result.observedAt) : await serviceSupabase.rpc("confirm_team_workweek_google_series_transition", {
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


/** Compensate one immutable generation, retaining only the history confirmed by PostgreSQL. */
export async function compensateTeamWorkweekGeneration({
  accessToken, publicationId, generation, serviceSupabase, bookkeeping,
  now = () => new Date(),
  cleanupEffect = cleanupGoogleWorkweekEffect,
  discoverInstance = discoverGoogleWorkweekInstance,
  recoverWrite = recoverGoogleWorkweekWrite,
  journaled = false,
  onRecoveryReason,
}: {
  accessToken: GoogleCalendarCapability;
  publicationId: string;
  generation: number;
  bookkeeping?: WorkweekPublicationBookkeeping;
  serviceSupabase: SupabaseClient;
  now?: () => Date;
  cleanupEffect?: typeof cleanupGoogleWorkweekEffect;
  discoverInstance?: typeof discoverGoogleWorkweekInstance;
  recoverWrite?: typeof recoverGoogleWorkweekWrite;
  journaled?: boolean;
  onRecoveryReason?: (reason: WorkweekRecoveryReason) => void;
}): Promise<WorkweekExecutionDelayClass | null> {
  return await withProviderOperation<WorkweekExecutionDelayClass | null>({
    accessToken, publicationId, generation, serviceSupabase, bookkeeping, now, purpose: "cleanup", journaled, recoverWrite,
  }, async operationId => {
    const prepare = async () => {
      const result = await serviceSupabase.rpc("prepare_team_workweek_effect_cleanup", {
        p_publication_id: publicationId, p_generation: generation,
      });
      const effects = !result.error && Array.isArray(result.data?.effects) ? result.data.effects as PreparedWorkweekEffect[] : null;
      if (effects) bookkeeping?.preparedEffects(effects);
      return effects;
    };
    const confirm = async (effect: PreparedWorkweekEffect, etag: string, preserved: boolean) => {
      const result = bookkeeping ? await bookkeeping.confirmCleanup(effect.id, generation, etag, preserved) : await serviceSupabase.rpc("confirm_team_workweek_planned_cleanup", {
        p_effect_id: effect.id, p_generation: generation, p_etag: etag, p_preserved: preserved,
      });
      return result.error ? "storage_failed" as const : null;
    };
    for (const stage of ["create", "crossing", "predecessor"] as const) {
      // Earlier confirmations affect the next stage's cleanup plan and history disposition.
      const effects = await prepare();
      if (!effects) return "storage_failed";
      for (let effect of effects) {
        const kind = effect.operation === "create" ? "create" : effect.kind === "cleanup_crossing" ? "crossing" : "predecessor";
        if (kind !== stage || effect.state === "cleaned") continue;
        if (effect.kind === "cleanup_crossing") {
          const parent = effects.find(item => item.id === effect.cleanupParentId);
          if (!parent || parent.state !== "cleaned") return "storage_failed";
          if (!parent.cleanupPreserved) {
            const error = await confirm(effect, "absent", false);
            if (error) return error;
            continue;
          }
          if (!effect.expectedEtag) {
            const bound = await bindCrossingInstance({ serviceSupabase, accessToken, discoverInstance }, effect);
            if (typeof bound === "string") return bound;
            effect = bound;
          }
        }
        const error = await mutateAndConfirmEffect({ bookkeeping, serviceSupabase, accessToken, now, operationId, effect,
          mutate: cleanupEffect,
          confirm: result => confirm(effect, result.etag, result.preserved ?? false),
        });
        if (error) return error;
      }
    }
    return null;
  }, async (errorClass, reason) => {
    onRecoveryReason?.(reason);
    return errorClass;
  });
}
