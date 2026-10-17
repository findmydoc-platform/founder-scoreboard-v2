import type { WorkweekBookkeeping } from "./team-workweek-bookkeeping";
import type { NextRequest } from "next/server";
import type { GoogleCalendarCapability } from "@/lib/credentials";
import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextVersionMondayIso } from "../model/team-workweek-draft";
import { GoogleWorkspaceOAuthContractError } from "@/lib/google-calendar-errors";
import { calendarForWorkweekOwner } from "./team-workweek-calendar";
import {
  observeGoogleWorkweek,
  type GoogleWorkweekObservation,
  type GoogleWorkweekReconciliationResult,
} from "./team-workweek-reconciliation-core";
import { captureObservedTeamWorkweekConflict } from "./team-workweek-conflicts";
import { loadTeamWorkweekObservationContext } from "./team-workweek-observation-context";
import { publishTeamWorkweek, TeamWorkweekPublicationError } from "./team-workweek-publication";

type ReconciliationErrorClass =
  | "provider_unavailable"
  | "quota_exceeded"
  | "oauth_reconnect_required"
  | "provider_identity_mismatch"
  | "invalid_series"
  | "invalid_windows"
  | "founderops_changed"
  | "storage_failed";

type ReconciliationStatus = Readonly<{
  state: "unchanged" | "updated" | "delayed" | "conflict";
  lastSuccessfulSyncAt: string | null;
  recovery: "retry" | "reconnect" | "resolve_conflict" | "restart" | null;
  effectiveAt?: string | null;
  effectiveUntil?: string | null;
}>;

type PublicationRow = Readonly<{
  id: string;
  source_version_id: string;
  owner_profile_id: string;
  effective_from: string;
  publication_revision: number;
  last_sync_at: string | null;
}>;

type PreparingPublicationRow = PublicationRow & Readonly<{ status: "preparing" }>;
type PreparingReconciliationRow = PreparingPublicationRow & Readonly<{ predecessor_publication_id: string | null }>;

export class TeamWorkweekReconciliationError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "TeamWorkweekReconciliationError";
  }
}

function reconciliationFingerprint(
  observations: GoogleWorkweekObservation[],
  windows: Array<Readonly<{ weekday: number; startMinute: number; endMinute: number }>>,
) {
  return createHash("sha256").update(JSON.stringify({ observations: observations.map(({seriesId,observedEtag,founderopsRevision,providerState})=>({seriesId,observedEtag,founderopsRevision,providerState})), windows })).digest("hex");
}

async function recordFailure(
  serviceSupabase: SupabaseClient,
  publication: Pick<PublicationRow, "id" | "publication_revision">,
  state: "delayed" | "conflict",
  errorClass: ReconciliationErrorClass,
  observedAt: string,
) {
  const { error } = await serviceSupabase.rpc("record_google_team_workweek_reconciliation_state", {
    p_publication_id: publication.id,
    p_publication_revision: publication.publication_revision,
    p_state: state,
    p_error_class: errorClass,
    p_observed_at: observedAt,
  });
  if (error) throw new TeamWorkweekReconciliationError("unavailable", "Abgleichstatus konnte nicht gespeichert werden.");
}

async function recordSuccess(
  serviceSupabase: SupabaseClient,
  publication: Pick<PublicationRow, "id" | "publication_revision">,
  observedAt: string,
  bookkeeping?: WorkweekBookkeeping,
) {
  const { error } = bookkeeping ? await bookkeeping.recordReconciliation({ publicationId: publication.id, revision: publication.publication_revision, observedAt }) : await serviceSupabase.rpc("record_google_team_workweek_reconciliation_state", {
    p_publication_id: publication.id,
    p_publication_revision: publication.publication_revision,
    p_state: "confirmed",
    p_error_class: null,
    p_observed_at: observedAt,
  });
  if (error) throw new TeamWorkweekReconciliationError("unavailable", "Abgleichstatus konnte nicht bestätigt werden.");
}

function delayedStatus(
  publication: Pick<PublicationRow, "last_sync_at">,
  errorClass: ReconciliationErrorClass,
): ReconciliationStatus {
  return {
    state: errorClass === "provider_identity_mismatch" || errorClass === "invalid_series"
      || errorClass === "invalid_windows" || errorClass === "founderops_changed"
      ? "conflict"
      : "delayed",
    lastSuccessfulSyncAt: publication.last_sync_at,
    recovery: errorClass === "oauth_reconnect_required"
      ? "reconnect"
      : errorClass === "provider_identity_mismatch" || errorClass === "invalid_series"
        || errorClass === "invalid_windows" || errorClass === "founderops_changed"
        ? "resolve_conflict"
        : "retry",
  };
}

async function finishPublication({
  request,
  bookkeeping,
  now,
  previousLastSyncAt,
  publish,
  serviceSupabase,
  statusPublication,
  userSupabase,
  versionId,
}: {
  request?: NextRequest;
  bookkeeping?: WorkweekBookkeeping;
  now: () => Date;
  previousLastSyncAt: string | null;
  publish: typeof publishTeamWorkweek;
  serviceSupabase: SupabaseClient;
  statusPublication: Pick<PublicationRow, "id" | "publication_revision">;
  userSupabase: SupabaseClient;
  versionId: string;
}): Promise<ReconciliationStatus> {
  let publication: Awaited<ReturnType<typeof publishTeamWorkweek>>;
  try {
    publication = await publish({ request, bookkeeping, serviceSupabase, userSupabase, versionId, now });
  } catch (error) {
    if (error instanceof TeamWorkweekPublicationError && error.code === "forbidden") {
      throw new TeamWorkweekReconciliationError("forbidden", error.message);
    }
    const observedAt = now().toISOString();
    const errorClass: ReconciliationErrorClass = error instanceof TeamWorkweekPublicationError
      && (error.code === "conflict" || error.code === "not_found" || error.code === "invalid_request")
      ? "founderops_changed"
      : error instanceof TeamWorkweekPublicationError && error.code === "reconnect_required"
        ? "oauth_reconnect_required"
        : "storage_failed";
    const state = "delayed";
    await recordFailure(serviceSupabase, statusPublication, state, errorClass, observedAt);
    return errorClass === "founderops_changed"
      ? { state: "delayed", lastSuccessfulSyncAt: previousLastSyncAt, recovery: "restart" }
      : delayedStatus({ last_sync_at: previousLastSyncAt }, errorClass);
  }

  if (publication.status === "published") {
    await recordSuccess(serviceSupabase, {
      id: publication.id,
      publication_revision: publication.publicationRevision,
    }, publication.lastSyncAt || now().toISOString(), bookkeeping);
    return { state: "updated", lastSuccessfulSyncAt: publication.lastSyncAt, recovery: null, effectiveAt:publication.effectiveAt,effectiveUntil:publication.effectiveUntil };
  }
  const errorClass: ReconciliationErrorClass = publication.recovery === "reconnect"
    ? "oauth_reconnect_required"
    : publication.recovery === "identity_conflict"
      ? "provider_identity_mismatch"
      : "provider_unavailable";
  const state = errorClass === "provider_identity_mismatch" ? "conflict" : "delayed";
  await recordFailure(serviceSupabase, statusPublication, state, errorClass, now().toISOString());
  return delayedStatus({ last_sync_at: previousLastSyncAt }, errorClass);
}

function errorClassForObservation(
  result: Extract<GoogleWorkweekReconciliationResult, { state: "conflict" | "delayed" }>,
) {
  return result.errorClass;
}

export async function reconcileTeamWorkweek({
  request,
  bookkeeping,
  getAccessToken = calendarForWorkweekOwner,
  observe = observeGoogleWorkweek,
  now = () => new Date(),
  ownerProfileId,
  publish = publishTeamWorkweek,
  serviceSupabase,
  userSupabase,
}: {
  request?: NextRequest;
  bookkeeping?: WorkweekBookkeeping;
  getAccessToken?: typeof calendarForWorkweekOwner;
  observe?: typeof observeGoogleWorkweek;
  now?: () => Date;
  ownerProfileId: string;
  publish?: typeof publishTeamWorkweek;
  serviceSupabase: SupabaseClient;
  userSupabase: SupabaseClient;
}): Promise<ReconciliationStatus> {
  const preparingResponse = await serviceSupabase
    .from("team_workweek_publications")
    .select("id,source_version_id,owner_profile_id,effective_from,publication_revision,last_sync_at,status,predecessor_publication_id")
    .eq("owner_profile_id", ownerProfileId)
    .eq("status", "preparing")
    .order("publication_revision", { ascending: false })
    .limit(1)
    .maybeSingle<PreparingReconciliationRow>();
  if (preparingResponse.error) throw new TeamWorkweekReconciliationError("unavailable", "Abgleichstatus ist nicht verfügbar.");
  if (preparingResponse.data) {
    const versionResponse = await serviceSupabase
      .from("team_workweek_versions")
      .select("id,origin,google_reconciliation_source_publication_id")
      .eq("id", preparingResponse.data.source_version_id)
      .maybeSingle<{ id: string; origin: "owner" | "google_reconciliation"; google_reconciliation_source_publication_id: string | null }>();
    if (versionResponse.error || !versionResponse.data) {
      throw new TeamWorkweekReconciliationError("unavailable", "Vorbereitete Grundwoche ist nicht verfügbar.");
    }
    if (versionResponse.data.origin !== "google_reconciliation") {
      return delayedStatus(preparingResponse.data, "founderops_changed");
    }
    const predecessorResponse = preparingResponse.data.predecessor_publication_id
      ? await serviceSupabase
        .from("team_workweek_publications")
        .select("id,publication_revision,last_sync_at")
        .eq("id", preparingResponse.data.predecessor_publication_id)
        .maybeSingle<Pick<PublicationRow, "id" | "publication_revision" | "last_sync_at">>()
      : null;
    if (predecessorResponse?.error) {
      throw new TeamWorkweekReconciliationError("unavailable", "Letzter bestätigter Abgleich ist nicht verfügbar.");
    }
    if (!predecessorResponse?.data) {
      throw new TeamWorkweekReconciliationError("unavailable", "Ausgangsversion des Abgleichs ist nicht verfügbar.");
    }
    return await finishPublication({
      request,
      bookkeeping,
      now,
      previousLastSyncAt: predecessorResponse?.data?.last_sync_at || null,
      publish,
      serviceSupabase,
      statusPublication: predecessorResponse.data,
      userSupabase,
      versionId: versionResponse.data.id,
    });
  }

  let context: Awaited<ReturnType<typeof loadTeamWorkweekObservationContext>>;
  try { context=await loadTeamWorkweekObservationContext(serviceSupabase,ownerProfileId,now()); }
  catch { throw new TeamWorkweekReconciliationError("unavailable","Bestätigte App-Arbeitswoche ist nicht verfügbar."); }
  if(!context) throw new TeamWorkweekReconciliationError("not_found","Noch keine aktuell gültige App-Arbeitswoche vorhanden.");
  const {publication,series,logicalWindows}=context;

  let accessToken: GoogleCalendarCapability;
  try {
    accessToken = await getAccessToken(serviceSupabase, ownerProfileId, request);
  } catch (error) {
    const errorClass: ReconciliationErrorClass = error instanceof GoogleWorkspaceOAuthContractError
      && error.code === "reconnect_required"
      ? "oauth_reconnect_required"
      : "provider_unavailable";
    const observedAt = now().toISOString();
    await recordFailure(serviceSupabase, publication, "delayed", errorClass, observedAt);
    return delayedStatus(publication, errorClass);
  }

  if(context.partialGoogleState){
    await recordFailure(serviceSupabase,publication,"delayed","provider_unavailable",now().toISOString());
    return delayedStatus(publication,"provider_unavailable");
  }
  const observation = await observe({ accessToken, now, series, logicalWindows });
  if(observation.state==="conflict" && observation.observations){
    await captureObservedTeamWorkweekConflict(serviceSupabase,ownerProfileId,publication,observation);
    return delayedStatus(publication,"founderops_changed");
  }
  if (observation.state === "delayed" || observation.state === "conflict") {
    const errorClass = errorClassForObservation(observation);
    await recordFailure(serviceSupabase, publication, observation.state, errorClass, observation.observedAt);
    return delayedStatus(publication, errorClass);
  }
  if (observation.state === "unchanged") {
    const { error } = await serviceSupabase.rpc("confirm_google_team_workweek_observation", {
      p_publication_id: publication.id,
      p_publication_revision: publication.publication_revision,
      p_observations: observation.observations,
      p_observed_at: observation.observedAt,
    });
    if (error) throw new TeamWorkweekReconciliationError("conflict", "Grundwoche wurde während des Abgleichs geändert.");
    return { state: "unchanged", lastSuccessfulSyncAt: observation.observedAt, recovery: null };
  }

  const effectiveFrom = nextVersionMondayIso(publication.effective_from, now());
  const fingerprint = reconciliationFingerprint(observation.observations, observation.windows);
  const preparedResponse = await serviceSupabase.rpc("prepare_google_team_workweek_reconciliation", {
    p_owner_profile_id: ownerProfileId,
    p_source_publication_id: publication.id,
    p_source_publication_revision: publication.publication_revision,
    p_effective_from: effectiveFrom,
    p_observations: observation.observations,
    p_windows: observation.windows,
    p_fingerprint: fingerprint,
    p_observed_at: observation.observedAt,
  });
  if (preparedResponse.error || !preparedResponse.data || typeof preparedResponse.data.versionId !== "string") {
    if(preparedResponse.error?.code==="P0003") {
      await captureObservedTeamWorkweekConflict(serviceSupabase,ownerProfileId,publication,observation);
      return delayedStatus(publication,"founderops_changed");
    }
    const errorClass: ReconciliationErrorClass = preparedResponse.error?.code === "P0003"
      || preparedResponse.error?.code === "P0004"
      ? "founderops_changed"
      : "storage_failed";
    await recordFailure(
      serviceSupabase,
      publication,
      errorClass === "founderops_changed" ? "conflict" : "delayed",
      errorClass,
      observation.observedAt,
    );
    return delayedStatus(publication, errorClass);
  }

  return await finishPublication({
      request,
      bookkeeping,
    now,
    previousLastSyncAt: publication.last_sync_at,
    publish,
    serviceSupabase,
    statusPublication: publication,
    userSupabase,
    versionId: preparedResponse.data.versionId,
  });
}
