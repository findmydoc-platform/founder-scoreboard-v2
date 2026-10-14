import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureGoogleWorkweekSeries,
  ensureGoogleWorkweekSeriesTransition,
  googleWorkweekRecovery,
  type GoogleWorkweekSeriesResult,
  type PreparedWorkweekPublication,
} from "./team-workweek-publication-core";
import { cleanupGoogleWorkweekEffect, discoverGoogleWorkweekInstance, ensureGoogleWorkweekEffect } from "./team-workweek-immediate-effects";
import { GoogleWorkspaceOAuthContractError } from "./google-workspace-oauth-core";
import { getGoogleWorkspaceAccessToken } from "./google-workspace-oauth";

type PublicationErrorCode =
  | "invalid_request"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "reconnect_required"
  | "unavailable";

export class TeamWorkweekPublicationError extends Error {
  constructor(readonly code: PublicationErrorCode, message: string) {
    super(message);
    this.name = "TeamWorkweekPublicationError";
  }
}

export type TeamWorkweekPublicationResult = Readonly<{
  successorPublicationId?: string | null;
  effectiveUntil?: string | null;
  activationMode?: "immediate" | "future_monday";
  effectiveAt?: string | null;
  id: string;
  status: "preparing" | "published";
  syncState: "delayed" | "confirmed";
  publishedAt: string | null;
  lastSyncAt: string | null;
  publicationRevision: number;
  recovery: "retry" | "reconnect" | "identity_conflict" | null;
}>;

export type TeamWorkweekPublicationDelayClass = Extract<GoogleWorkweekSeriesResult, { state: "delayed" }>["errorClass"] | "storage_failed";

function publicationError(error: { code?: string } | null | undefined) {
  if (error?.code === "42501") {
    return new TeamWorkweekPublicationError("forbidden", "Keine Berechtigung für diese Grundwoche.");
  }
  if (error?.code === "P0002") {
    return new TeamWorkweekPublicationError("not_found", "Private Grundwoche wurde nicht gefunden.");
  }
  if (error?.code === "P0003") {
    return new TeamWorkweekPublicationError("conflict", "Google-Synchronisierung ist noch nicht vollständig bestätigt.");
  }
  if (error?.code === "P0004") {
    return new TeamWorkweekPublicationError("conflict", "Die veröffentlichte Grundwoche wurde zwischenzeitlich geändert.");
  }
  if (error?.code === "22023") {
    return new TeamWorkweekPublicationError("invalid_request", "Grundwoche ist ungültig.");
  }
  return new TeamWorkweekPublicationError("unavailable", "Grundwoche konnte nicht veröffentlicht werden.");
}

function isPreparedPublication(value: unknown): value is PreparedWorkweekPublication {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<PreparedWorkweekPublication>;
  return typeof input.id === "string"
    && typeof input.sourceVersionId === "string"
    && typeof input.ownerProfileId === "string"
    && typeof input.effectiveFrom === "string"
    && input.timezone === "Europe/Berlin"
    && (input.status === "preparing" || input.status === "published")
    && (input.syncState === "pending" || input.syncState === "delayed" || input.syncState === "confirmed")
    && Number.isInteger(input.publicationRevision)
    && (input.publishedAt === null || typeof input.publishedAt === "string")
    && (input.lastSyncAt === null || typeof input.lastSyncAt === "string")
    && (input.activationMode !== "immediate" || (
      typeof input.effectiveAt === "string" && Number.isFinite(new Date(input.effectiveAt).getTime())
      && Number.isInteger(input.attemptGeneration) && Array.isArray(input.effects)
      && input.effects.every((effect) => effect && typeof effect.id === "string"
        && effect.generation === input.attemptGeneration && effect.calendarId === "primary"
        && typeof effect.googleEventId === "string" && effect.payload?.id === effect.googleEventId)
    ))
    && Array.isArray(input.series)
    && input.series.every((series) => Boolean(
      series
      && typeof series.id === "string"
      && series.calendarId === "primary"
      && typeof series.googleEventId === "string"
      && (series.state === "pending" || series.state === "confirmed")
      && Number.isInteger(series.weekday)
      && Number.isInteger(series.startMinute)
      && Number.isInteger(series.endMinute),
    ))
    && Array.isArray(input.transitions)
    && input.transitions.every((transition) => Boolean(
      transition
      && typeof transition.id === "string"
      && transition.calendarId === "primary"
      && typeof transition.googleEventId === "string"
      && typeof transition.predecessorSeriesId === "string"
      && (transition.state === "pending" || transition.state === "confirmed")
      && typeof transition.expectedEtag === "string"
      && Number.isInteger(transition.expectedFounderopsRevision)
      && Number.isInteger(transition.recurrenceCount),
    ));
}

function isPublicationResult(value: unknown): value is TeamWorkweekPublicationResult {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<TeamWorkweekPublicationResult>;
  return typeof input.id === "string"
    && (input.status === "preparing" || input.status === "published")
    && (input.syncState === "delayed" || input.syncState === "confirmed")
    && Number.isInteger(input.publicationRevision);
}

function recoveryFor(errorClass: TeamWorkweekPublicationDelayClass): TeamWorkweekPublicationResult["recovery"] {
  return errorClass === "storage_failed" ? "retry" : googleWorkweekRecovery(errorClass);
}

function resultWithRecovery(value: unknown, recovery: TeamWorkweekPublicationResult["recovery"]) {
  if (!isPublicationResult(value)) {
    throw new TeamWorkweekPublicationError("unavailable", "Veröffentlichungsstatus konnte nicht bestätigt werden.");
  }
  return { ...value, recovery: value.status === "published" ? null : recovery } satisfies TeamWorkweekPublicationResult;
}

async function markDelayed(
  serviceSupabase: SupabaseClient,
  publicationId: string,
  errorClass: TeamWorkweekPublicationDelayClass,
  observedAt: string,
) {
  const { data, error } = await serviceSupabase.rpc("delay_team_workweek_publication", {
    p_publication_id: publicationId,
    p_error_class: errorClass,
    p_observed_at: observedAt,
  });
  if (error) throw publicationError(error);
  return resultWithRecovery(data, recoveryFor(errorClass));
}

export async function publishTeamWorkweek({
  serviceSupabase,
  userSupabase,
  versionId,
  ensureSeries = ensureGoogleWorkweekSeries,
  ensureTransition = ensureGoogleWorkweekSeriesTransition,
  ensureEffect = ensureGoogleWorkweekEffect,
  cleanupEffect = cleanupGoogleWorkweekEffect,
  discoverInstance = discoverGoogleWorkweekInstance,
  now = () => new Date(),
  transitionsFirst = false,
}: {
  serviceSupabase: SupabaseClient;
  userSupabase: SupabaseClient;
  versionId: string;
  ensureSeries?: typeof ensureGoogleWorkweekSeries;
  ensureTransition?: typeof ensureGoogleWorkweekSeriesTransition;
  ensureEffect?: typeof ensureGoogleWorkweekEffect;
  cleanupEffect?: typeof cleanupGoogleWorkweekEffect;
  discoverInstance?: typeof discoverGoogleWorkweekInstance;
  now?: () => Date;
  transitionsFirst?: boolean;
}): Promise<TeamWorkweekPublicationResult> {
  const preparedResponse = await userSupabase.rpc("prepare_team_workweek_publication", {
    p_version_id: versionId,
  });
  if (preparedResponse.error) throw publicationError(preparedResponse.error);
  if (!isPreparedPublication(preparedResponse.data)) {
    throw new TeamWorkweekPublicationError("unavailable", "Grundwoche konnte nicht vorbereitet werden.");
  }
  let publication = preparedResponse.data;
  if (publication.status === "published") {
    return {
      id: publication.id,
      status: "published",
      syncState: "confirmed",
      publishedAt: publication.publishedAt,
      lastSyncAt: publication.lastSyncAt,
      publicationRevision: publication.publicationRevision,
      recovery: null,
      effectiveUntil: publication.effectiveUntil,
      successorPublicationId: publication.successorPublicationId,
      ...(publication.effectiveAt ? { effectiveAt: publication.effectiveAt, activationMode: publication.activationMode } : {}),
    };
  }

  let accessToken: string;
  try {
    accessToken = await getGoogleWorkspaceAccessToken(serviceSupabase, publication.ownerProfileId);
  } catch (error) {
    const observedAt = now().toISOString();
    const reconnectRequired = error instanceof GoogleWorkspaceOAuthContractError && error.code === "reconnect_required";
    return {
      ...await markDelayed(serviceSupabase, publication.id,
        reconnectRequired ? "oauth_reconnect_required" : "provider_unavailable", observedAt),
      ...(publication.effectiveAt ? { effectiveAt: publication.effectiveAt, activationMode: publication.activationMode } : {}),
    };
  }

  if (publication.effects !== undefined) {
    const delayed = async (errorClass: TeamWorkweekPublicationDelayClass) => ({
      ...await markDelayed(serviceSupabase, publication.id, errorClass, now().toISOString()),
      activationMode: publication.activationMode, effectiveAt: publication.effectiveAt,
    });
    const expired = () => !publication.effectiveAt || now().getTime() >= new Date(publication.effectiveAt).getTime();
    if (expired()) {
      for (const effect of publication.effects || []) {
        if (effect.state === "cleaned") continue;
        const result = await cleanupEffect({ accessToken, effect, now });
        if (result.state === "delayed") return await delayed(result.errorClass);
        const restoring = effect.operation && effect.operation !== "create" && !(effect.instanceOf && !effect.expectedEtag);
        const cleanup = await serviceSupabase.rpc(restoring ? "confirm_team_workweek_effect_restoration" : "confirm_team_workweek_effect_cleanup", {
          p_effect_id: effect.id, p_generation: effect.generation, ...(restoring ? {p_etag:result.etag} : {}),
        });
        if (cleanup.error) return await delayed("storage_failed");
      }
      const replanned = await userSupabase.rpc("prepare_team_workweek_publication", { p_version_id: versionId });
      if (replanned.error) throw publicationError(replanned.error);
      if (!isPreparedPublication(replanned.data) || replanned.data.status !== "preparing") {
        // A concurrent/lost finalization is never compensated or overwritten by a new attempt.
        if (isPreparedPublication(replanned.data) && replanned.data.status === "published") {
          return {
            id: replanned.data.id, status: "published", syncState: "confirmed", recovery: null,
            publishedAt: replanned.data.publishedAt, lastSyncAt: replanned.data.lastSyncAt,
            publicationRevision: replanned.data.publicationRevision,
            activationMode: replanned.data.activationMode, effectiveAt: replanned.data.effectiveAt,
          };
        }
        throw new TeamWorkweekPublicationError("unavailable", "Neuer Veröffentlichungsbeginn konnte nicht bestätigt werden.");
      }
      publication = replanned.data;
      if (expired()) return await delayed("provider_unavailable");
    }
    const syncEffect = async (effect: NonNullable<PreparedWorkweekPublication["effects"]>[number]): Promise<TeamWorkweekPublicationDelayClass | null> => {
      if (expired()) return "provider_unavailable";
      if (effect.state === "confirmed") return null;
      if (effect.instanceOf && !effect.expectedEtag) {
        const observed = await discoverInstance({accessToken,effect});
        if (observed.state === "delayed") return observed.errorClass;
        const bound = await serviceSupabase.rpc("bind_team_workweek_crossing_instance", {
          p_effect_id:effect.id,p_generation:effect.generation,p_event_id:observed.eventId,p_etag:observed.etag,p_original_payload:observed.originalPayload,
        });
        if (bound.error || !bound.data || bound.data.id !== effect.id) return "storage_failed";
        effect = bound.data;
      }
      const result = await ensureEffect({ accessToken, effect, now });
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
        const results = await Promise.all(stage.slice(offset, offset + 6).map(syncEffect));
        const failure = results.find((result) => result !== null);
        if (failure) return await delayed(failure);
      }
    }
    if (expired()) return await delayed("provider_unavailable");
    const finalized = await userSupabase.rpc("finalize_team_workweek_publication", { p_publication_id: publication.id });
    if (finalized.error?.code === "P0005") return await delayed("provider_unavailable");
    if (finalized.error) throw publicationError(finalized.error);
    if (!isPublicationResult(finalized.data) || finalized.data.status !== "published") {
      throw new TeamWorkweekPublicationError("unavailable", "Veröffentlichungsstatus konnte nicht bestätigt werden.");
    }
    return { ...finalized.data, recovery: null };
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
    if (errorClass) return await markDelayed(serviceSupabase, publication.id, errorClass, now().toISOString());
  }

  const finalized = await userSupabase.rpc("finalize_team_workweek_publication", {
    p_publication_id: publication.id,
  });
  if (finalized.error) throw publicationError(finalized.error);
  if (!isPublicationResult(finalized.data) || finalized.data.status !== "published") {
    throw new TeamWorkweekPublicationError("unavailable", "Grundwoche konnte nicht veröffentlicht werden.");
  }
  return { ...finalized.data, recovery: null };
}

export async function delayTeamWorkweekPublication({
  errorClass,
  now = () => new Date(),
  serviceSupabase,
  userSupabase,
  versionId,
}: {
  errorClass: Exclude<TeamWorkweekPublicationDelayClass, "storage_failed" | "provider_identity_mismatch">;
  now?: () => Date;
  serviceSupabase: SupabaseClient;
  userSupabase: SupabaseClient;
  versionId: string;
}): Promise<TeamWorkweekPublicationResult> {
  const preparedResponse = await userSupabase.rpc("prepare_team_workweek_publication", {
    p_version_id: versionId,
  });
  if (preparedResponse.error) throw publicationError(preparedResponse.error);
  if (!isPreparedPublication(preparedResponse.data)) {
    throw new TeamWorkweekPublicationError("unavailable", "Grundwoche konnte nicht vorbereitet werden.");
  }
  if (preparedResponse.data.status === "published") {
    return {
      id: preparedResponse.data.id,
      status: "published",
      syncState: "confirmed",
      publishedAt: preparedResponse.data.publishedAt,
      lastSyncAt: preparedResponse.data.lastSyncAt,
      publicationRevision: preparedResponse.data.publicationRevision,
      recovery: null,
    };
  }
  return {
    ...await markDelayed(serviceSupabase, preparedResponse.data.id, errorClass, now().toISOString()),
    ...(preparedResponse.data.effectiveAt ? { effectiveAt: preparedResponse.data.effectiveAt, activationMode: preparedResponse.data.activationMode } : {}),
  };
}
