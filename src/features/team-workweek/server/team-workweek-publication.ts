import type { WorkweekBookkeeping, WorkweekPublicationBookkeeping } from "./team-workweek-bookkeeping";
import type { NextRequest } from "next/server";
import type { GoogleCalendarCapability } from "@/lib/credentials";
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  googleWorkweekRecovery,
  type PreparedWorkweekPublication,
} from "./team-workweek-publication-core";
import { cleanupGoogleWorkweekEffect, discoverGoogleWorkweekInstance, ensureGoogleWorkweekEffect, recoverGoogleWorkweekWrite } from "./team-workweek-immediate-effects";
import { GoogleWorkspaceOAuthContractError } from "@/lib/google-calendar-errors";
import { calendarForWorkweekOwner } from "./team-workweek-calendar";
import { compensateTeamWorkweekGeneration, executeTeamWorkweekPublication, type WorkweekExecutionDelayClass } from "./team-workweek-execution";

type PublicationErrorCode =
  | "invalid_request"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "reconnect_required"
  | "completion_pending"
  | "unavailable";

export class TeamWorkweekPublicationError extends Error {
  constructor(readonly code: PublicationErrorCode, message: string, readonly completionPending = false) {
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

export type TeamWorkweekPublicationDelayClass = WorkweekExecutionDelayClass;

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
    && input.writeJournalVersion === 1
    && Number.isInteger(input.attemptGeneration) && Number(input.attemptGeneration) > 0
    && typeof input.effectiveAt === "string" && Number.isFinite(Date.parse(input.effectiveAt))
    && Array.isArray(input.effects)
    && input.effects.every(effect => effect && typeof effect.id === "string"
      && effect.generation === input.attemptGeneration && effect.calendarId === "primary"
      && typeof effect.googleEventId === "string" && effect.payload?.id === effect.googleEventId);
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
  bookkeeping?: WorkweekPublicationBookkeeping,
) {
  const { data, error } = bookkeeping ? await bookkeeping.delay(errorClass, observedAt) : await serviceSupabase.rpc("delay_team_workweek_publication", {
    p_publication_id: publicationId,
    p_error_class: errorClass,
    p_observed_at: observedAt,
  });
  if (error) throw publicationError(error);
  return resultWithRecovery(data, recoveryFor(errorClass));
}

export async function publishTeamWorkweek({
  request,
  bookkeeping,
  serviceSupabase,
  userSupabase,
  versionId,
  ensureEffect = ensureGoogleWorkweekEffect,
  cleanupEffect = cleanupGoogleWorkweekEffect,
  discoverInstance = discoverGoogleWorkweekInstance,
  recoverWrite = recoverGoogleWorkweekWrite,
  now = () => new Date(),
}: {
  bookkeeping?: WorkweekBookkeeping;
  serviceSupabase: SupabaseClient;
  userSupabase: SupabaseClient;
  versionId: string;
  ensureEffect?: typeof ensureGoogleWorkweekEffect;
  cleanupEffect?: typeof cleanupGoogleWorkweekEffect;
  discoverInstance?: typeof discoverGoogleWorkweekInstance;
  recoverWrite?: typeof recoverGoogleWorkweekWrite;
  now?: () => Date;
  request?: NextRequest;
}): Promise<TeamWorkweekPublicationResult> {
  const preparedResponse = await userSupabase.rpc("prepare_team_workweek_publication", {
    p_version_id: versionId, p_write_journal_version: 1,
  });
  if (preparedResponse.error) throw publicationError(preparedResponse.error);
  if (!isPreparedPublication(preparedResponse.data)) {
    throw new TeamWorkweekPublicationError("unavailable", "Grundwoche konnte nicht vorbereitet werden.");
  }
  let publication = preparedResponse.data;
  let publicationBookkeeping = bookkeeping?.forPublication(publication);
  if (publication.status === "published") {
    bookkeeping?.published(publication);
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

  let accessToken: GoogleCalendarCapability;
  try {
    accessToken = await calendarForWorkweekOwner(serviceSupabase, publication.ownerProfileId, request);
  } catch (error) {
    const observedAt = now().toISOString();
    const reconnectRequired = error instanceof GoogleWorkspaceOAuthContractError && error.code === "reconnect_required";
    return {
      ...await markDelayed(serviceSupabase, publication.id,
        reconnectRequired ? "oauth_reconnect_required" : "provider_unavailable", observedAt, publicationBookkeeping),
      ...(publication.effectiveAt ? { effectiveAt: publication.effectiveAt, activationMode: publication.activationMode } : {}),
    };
  }

  const delayed = async (errorClass: TeamWorkweekPublicationDelayClass) => ({
    ...await markDelayed(serviceSupabase, publication.id, errorClass, now().toISOString(), publicationBookkeeping),
    activationMode: publication.activationMode, effectiveAt: publication.effectiveAt,
  });
  const expired = () => !publication.effectiveAt || now().getTime() >= new Date(publication.effectiveAt).getTime();
  if (expired()) {
    const compensation = await compensateTeamWorkweekGeneration({accessToken,publicationId:publication.id,generation:publication.attemptGeneration,serviceSupabase,bookkeeping:publicationBookkeeping,now,cleanupEffect,discoverInstance,recoverWrite});
    if(compensation)return await delayed(compensation);
    const replanned = await userSupabase.rpc("prepare_team_workweek_publication", { p_version_id: versionId, p_write_journal_version: 1 });
    if (replanned.error) throw publicationError(replanned.error);
    if (!isPreparedPublication(replanned.data) || replanned.data.status !== "preparing") {
      // A concurrent/lost finalization is never compensated or overwritten by a new attempt.
      if (isPreparedPublication(replanned.data) && replanned.data.status === "published") {
        bookkeeping?.forPublication(replanned.data);
        bookkeeping?.published(replanned.data);
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
    publicationBookkeeping = bookkeeping?.forPublication(publication);
    if (expired()) return await delayed("provider_unavailable");
  }
  return await executeTeamWorkweekPublication({
    serviceSupabase, bookkeeping: publicationBookkeeping, publication, accessToken, ensureEffect, discoverInstance, recoverWrite, now, delayed,
    complete: async () => {
      const finalized = await userSupabase.rpc("finalize_team_workweek_publication", { p_publication_id: publication.id });
      if (finalized.error?.code === "P0005") return await delayed("provider_unavailable");
      if (finalized.error) {
        const failure = publicationError(finalized.error);
        if (failure.code === "unavailable") throw new TeamWorkweekPublicationError("completion_pending", "Google hat die Änderungen bestätigt. Der Abschluss in FounderOps ist noch offen. Setze die Veröffentlichung fort.", true);
        throw new TeamWorkweekPublicationError(failure.code, failure.message, true);
      }
      if (!isPublicationResult(finalized.data) || finalized.data.status !== "published") {
        throw new TeamWorkweekPublicationError("unavailable", "Veröffentlichungsstatus konnte nicht bestätigt werden.");
      }
      bookkeeping?.published(finalized.data);
      return { ...finalized.data, recovery: null };
    },
  });
}

export async function delayTeamWorkweekPublication({
  errorClass,
  now = () => new Date(),
  serviceSupabase,
  bookkeeping,
  userSupabase,
  versionId,
}: {
  errorClass: Exclude<TeamWorkweekPublicationDelayClass, "storage_failed" | "provider_identity_mismatch">;
  now?: () => Date;
  bookkeeping?: WorkweekBookkeeping;
  serviceSupabase: SupabaseClient;
  userSupabase: SupabaseClient;
  versionId: string;
}): Promise<TeamWorkweekPublicationResult> {
  const preparedResponse = await userSupabase.rpc("prepare_team_workweek_publication", {
    p_version_id: versionId, p_write_journal_version: 1,
  });
  if (preparedResponse.error) throw publicationError(preparedResponse.error);
  if (!isPreparedPublication(preparedResponse.data)) {
    throw new TeamWorkweekPublicationError("unavailable", "Grundwoche konnte nicht vorbereitet werden.");
  }
  const publicationBookkeeping = bookkeeping?.forPublication(preparedResponse.data);
  if (preparedResponse.data.status === "published") {
    bookkeeping?.published(preparedResponse.data);
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
    ...await markDelayed(serviceSupabase, preparedResponse.data.id, errorClass, now().toISOString(), publicationBookkeeping),
    ...(preparedResponse.data.effectiveAt ? { effectiveAt: preparedResponse.data.effectiveAt, activationMode: preparedResponse.data.activationMode } : {}),
  };
}
