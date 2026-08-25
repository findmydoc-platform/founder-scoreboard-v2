import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextVersionMondayIso } from "../model/team-workweek-draft";
import { GoogleWorkspaceOAuthContractError } from "./google-workspace-oauth-core";
import { getGoogleWorkspaceAccessToken } from "./google-workspace-oauth";
import {
  observeGoogleWorkweek,
  type GoogleWorkweekObservation,
  type GoogleWorkweekReconciliationResult,
  type KnownGoogleWorkweekSeries,
} from "./team-workweek-reconciliation-core";
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
  recovery: "retry" | "reconnect" | "resolve_conflict" | null;
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

type SeriesRow = Readonly<{
  id: string;
  calendar_id: "primary";
  google_event_id: string;
  confirmed_etag: string | null;
  confirmed_founderops_revision: number | null;
  provider_state: "active" | "deleted";
  team_workweek_windows: Readonly<{
    weekday: number;
    start_minute: number;
    end_minute: number;
  }> | Array<Readonly<{
    weekday: number;
    start_minute: number;
    end_minute: number;
  }>>;
}>;

export class TeamWorkweekReconciliationError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "TeamWorkweekReconciliationError";
  }
}

function firstRelation<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

function knownSeries(rows: SeriesRow[]): KnownGoogleWorkweekSeries[] | null {
  const output: KnownGoogleWorkweekSeries[] = [];
  for (const row of rows) {
    const window = firstRelation(row.team_workweek_windows);
    if (row.provider_state !== "active" || !row.confirmed_etag || !row.confirmed_founderops_revision || !window) return null;
    output.push({
      id: row.id,
      calendarId: row.calendar_id,
      googleEventId: row.google_event_id,
      confirmedEtag: row.confirmed_etag,
      confirmedFounderopsRevision: row.confirmed_founderops_revision,
      weekday: window.weekday,
      startMinute: window.start_minute,
      endMinute: window.end_minute,
    });
  }
  return output.sort((left, right) => (
    left.weekday - right.weekday
    || left.startMinute - right.startMinute
    || left.endMinute - right.endMinute
    || left.id.localeCompare(right.id)
  ));
}

function reconciliationFingerprint(
  observations: GoogleWorkweekObservation[],
  windows: Array<Readonly<{ weekday: number; startMinute: number; endMinute: number }>>,
) {
  return createHash("sha256").update(JSON.stringify({ observations, windows })).digest("hex");
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
) {
  const { error } = await serviceSupabase.rpc("record_google_team_workweek_reconciliation_state", {
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
  now,
  previousLastSyncAt,
  publish,
  serviceSupabase,
  statusPublication,
  userSupabase,
  versionId,
}: {
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
    publication = await publish({ serviceSupabase, userSupabase, versionId, now });
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
    const state = errorClass === "founderops_changed" ? "conflict" : "delayed";
    await recordFailure(serviceSupabase, statusPublication, state, errorClass, observedAt);
    return delayedStatus({ last_sync_at: previousLastSyncAt }, errorClass);
  }

  if (publication.status === "published") {
    await recordSuccess(serviceSupabase, {
      id: publication.id,
      publication_revision: publication.publicationRevision,
    }, publication.lastSyncAt || now().toISOString());
    return { state: "updated", lastSuccessfulSyncAt: publication.lastSyncAt, recovery: null };
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
  getAccessToken = getGoogleWorkspaceAccessToken,
  observe = observeGoogleWorkweek,
  now = () => new Date(),
  ownerProfileId,
  publish = publishTeamWorkweek,
  serviceSupabase,
  userSupabase,
}: {
  getAccessToken?: typeof getGoogleWorkspaceAccessToken;
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
      now,
      previousLastSyncAt: predecessorResponse?.data?.last_sync_at || null,
      publish,
      serviceSupabase,
      statusPublication: predecessorResponse.data,
      userSupabase,
      versionId: versionResponse.data.id,
    });
  }

  const publicationResponse = await serviceSupabase
    .from("team_workweek_publications")
    .select("id,source_version_id,owner_profile_id,effective_from,publication_revision,last_sync_at")
    .eq("owner_profile_id", ownerProfileId)
    .eq("status", "published")
    .is("effective_to", null)
    .order("publication_revision", { ascending: false })
    .limit(1)
    .maybeSingle<PublicationRow>();
  if (publicationResponse.error) throw new TeamWorkweekReconciliationError("unavailable", "Veröffentlichte Grundwoche ist nicht verfügbar.");
  if (!publicationResponse.data) throw new TeamWorkweekReconciliationError("not_found", "Noch keine veröffentlichte Grundwoche vorhanden.");
  const publication = publicationResponse.data;

  const seriesResponse = await serviceSupabase
    .from("team_workweek_google_series")
    .select("id,calendar_id,google_event_id,confirmed_etag,confirmed_founderops_revision,provider_state,team_workweek_windows!inner(weekday,start_minute,end_minute)")
    .eq("publication_id", publication.id)
    .eq("state", "confirmed")
    .order("id", { ascending: true });
  if (seriesResponse.error) throw new TeamWorkweekReconciliationError("unavailable", "Google-Zuordnungen sind nicht verfügbar.");
  const series = knownSeries((seriesResponse.data || []) as SeriesRow[]);
  if (!series) {
    const observedAt = now().toISOString();
    await recordFailure(serviceSupabase, publication, "conflict", "provider_identity_mismatch", observedAt);
    return delayedStatus(publication, "provider_identity_mismatch");
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(serviceSupabase, ownerProfileId);
  } catch (error) {
    const errorClass: ReconciliationErrorClass = error instanceof GoogleWorkspaceOAuthContractError
      && error.code === "reconnect_required"
      ? "oauth_reconnect_required"
      : "provider_unavailable";
    const observedAt = now().toISOString();
    await recordFailure(serviceSupabase, publication, "delayed", errorClass, observedAt);
    return delayedStatus(publication, errorClass);
  }

  const observation = await observe({ accessToken, now, series });
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

  const pendingResponse = await serviceSupabase
    .from("team_workweek_publications")
    .select("id,source_version_id,owner_profile_id,effective_from,publication_revision,last_sync_at,status,predecessor_publication_id")
    .eq("source_version_id", preparedResponse.data.versionId)
    .maybeSingle<PreparingReconciliationRow>();
  if (pendingResponse.error || !pendingResponse.data) {
    throw new TeamWorkweekReconciliationError("unavailable", "Vorbereiteter Google-Abgleich ist nicht verfügbar.");
  }
  return await finishPublication({
    now,
    previousLastSyncAt: publication.last_sync_at,
    publish,
    serviceSupabase,
    statusPublication: publication,
    userSupabase,
    versionId: preparedResponse.data.versionId,
  });
}
