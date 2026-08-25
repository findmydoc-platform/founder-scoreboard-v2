import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextVersionMondayIso } from "../model/team-workweek-draft";
import { getGoogleWorkspaceAccessToken } from "./google-workspace-oauth";
import {
  observeGoogleWorkweek,
  type GoogleWorkweekObservation,
  type KnownGoogleWorkweekSeries,
} from "./team-workweek-reconciliation-core";
import { GoogleWorkspaceOAuthContractError } from "./google-workspace-oauth-core";
import {
  publishTeamWorkweek,
  type TeamWorkweekPublicationDelayClass,
} from "./team-workweek-publication";

type Window = Readonly<{ weekday: number; startMinute: number; endMinute: number }>;

type PublicationRow = Readonly<{
  id: string;
  owner_profile_id: string;
  effective_from: string;
  publication_revision: number;
  windows: Array<{ weekday: number; startMinute: number; endMinute: number }>;
}>;

type VersionRow = Readonly<{
  id: string;
  owner_profile_id: string;
  effective_from: string;
  origin: "owner" | "google_reconciliation";
  team_workweek_windows: Array<{ weekday: number; start_minute: number; end_minute: number }>;
}>;

type SeriesRow = Readonly<{
  id: string;
  calendar_id: "primary";
  google_event_id: string;
  confirmed_etag: string | null;
  confirmed_founderops_revision: number | null;
  provider_state: "active" | "deleted";
  team_workweek_windows: { weekday: number; start_minute: number; end_minute: number }
    | Array<{ weekday: number; start_minute: number; end_minute: number }>;
}>;

type ConflictRow = Readonly<{
  id: string;
  owner_profile_id: string;
  base_publication_id: string;
  base_publication_revision: number;
  founderops_version_id: string;
  google_effective_from: string;
  google_windows: Window[];
  google_observations: GoogleWorkweekObservation[];
  google_fingerprint: string;
  founderops_fingerprint: string;
  conflict_revision: number;
  state: "open" | "resolving" | "resolved";
  decision: "founderops" | "google" | null;
  resolution_version_id: string | null;
  observed_at: string;
  team_workweek_versions: VersionRow | VersionRow[];
}>;

export type TeamWorkweekConflictView = Readonly<{
  id: string;
  conflictRevision: number;
  state: "open" | "resolving";
  decision: "founderops" | "google" | null;
  observedAt: string;
  founderops: Readonly<{ effectiveFrom: string; windows: Window[] }>;
  google: Readonly<{ effectiveFrom: string; windows: Window[] }>;
}>;

export class TeamWorkweekConflictError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "stale" | "unavailable",
    message: string,
    readonly delayClass: Exclude<TeamWorkweekPublicationDelayClass, "storage_failed" | "provider_identity_mismatch"> | null = null,
  ) {
    super(message);
    this.name = "TeamWorkweekConflictError";
  }
}

function firstRelation<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

function canonicalWindows(windows: Window[]) {
  return [...windows].sort((left, right) => (
    left.weekday - right.weekday
    || left.startMinute - right.startMinute
    || left.endMinute - right.endMinute
  ));
}

function versionWindows(version: VersionRow) {
  return canonicalWindows((version.team_workweek_windows || []).map((window) => ({
    weekday: window.weekday,
    startMinute: window.start_minute,
    endMinute: window.end_minute,
  })));
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function observationFingerprint(observations: GoogleWorkweekObservation[]) {
  return fingerprint(observations.map((observation) => ({
    seriesId: observation.seriesId,
    observedEtag: observation.observedEtag,
    founderopsRevision: observation.founderopsRevision,
    providerState: observation.providerState,
  })));
}

function knownSeries(rows: SeriesRow[]): KnownGoogleWorkweekSeries[] | null {
  const result: KnownGoogleWorkweekSeries[] = [];
  for (const row of rows) {
    const window = firstRelation(row.team_workweek_windows);
    if (row.provider_state !== "active" || !row.confirmed_etag || !row.confirmed_founderops_revision || !window) return null;
    result.push({
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
  return result;
}

async function loadObservationContext(serviceSupabase: SupabaseClient, ownerProfileId: string) {
  const publicationResponse = await serviceSupabase
    .from("team_workweek_publications")
    .select("id,owner_profile_id,effective_from,publication_revision,windows")
    .eq("owner_profile_id", ownerProfileId)
    .eq("status", "published")
    .is("effective_to", null)
    .order("publication_revision", { ascending: false })
    .limit(1)
    .maybeSingle<PublicationRow>();
  if (publicationResponse.error) {
    throw new TeamWorkweekConflictError("unavailable", "Bestätigte Grundwoche ist nicht verfügbar.");
  }
  if (!publicationResponse.data) throw new TeamWorkweekConflictError("not_found", "Noch keine bestätigte Grundwoche vorhanden.");
  const seriesResponse = await serviceSupabase
    .from("team_workweek_google_series")
    .select("id,calendar_id,google_event_id,confirmed_etag,confirmed_founderops_revision,provider_state,team_workweek_windows!inner(weekday,start_minute,end_minute)")
    .eq("publication_id", publicationResponse.data.id)
    .eq("state", "confirmed")
    .order("id", { ascending: true });
  if (seriesResponse.error) throw new TeamWorkweekConflictError("unavailable", "Google-Zuordnungen sind nicht verfügbar.");
  const series = knownSeries((seriesResponse.data || []) as SeriesRow[]);
  if (!series) throw new TeamWorkweekConflictError("stale", "Google-Zuordnung muss zuerst neu beobachtet werden.");
  return { publication: publicationResponse.data, series };
}

async function observeCurrentGoogle({
  getAccessToken,
  now,
  observe,
  ownerProfileId,
  serviceSupabase,
}: {
  getAccessToken: typeof getGoogleWorkspaceAccessToken;
  now: () => Date;
  observe: typeof observeGoogleWorkweek;
  ownerProfileId: string;
  serviceSupabase: SupabaseClient;
}) {
  const context = await loadObservationContext(serviceSupabase, ownerProfileId);
  let accessToken: string;
  try {
    accessToken = await getAccessToken(serviceSupabase, ownerProfileId);
  } catch (error) {
    throw new TeamWorkweekConflictError(
      "unavailable",
      error instanceof GoogleWorkspaceOAuthContractError && error.code === "reconnect_required"
        ? "Google-Verbindung muss erneuert werden."
        : "Google-Abgleich ist vorübergehend nicht verfügbar.",
      error instanceof GoogleWorkspaceOAuthContractError && error.code === "reconnect_required"
        ? "oauth_reconnect_required"
        : "provider_unavailable",
    );
  }
  const observation = await observe({ accessToken, now, series: context.series });
  if (observation.state === "delayed" || observation.state === "conflict") {
    throw new TeamWorkweekConflictError(
      observation.state === "conflict" ? "stale" : "unavailable",
      observation.state === "conflict"
        ? "Google-Änderung muss zuerst neu beobachtet werden."
        : "Google-Abgleich ist vorübergehend nicht verfügbar.",
      observation.state === "delayed"
        ? observation.errorClass === "quota_exceeded" ? "provider_unavailable" : observation.errorClass
        : null,
    );
  }
  return { ...context, observation };
}

export async function detectTeamWorkweekParallelConflict({
  getAccessToken = getGoogleWorkspaceAccessToken,
  now = () => new Date(),
  observe = observeGoogleWorkweek,
  ownerProfileId,
  serviceSupabase,
  versionId,
}: {
  getAccessToken?: typeof getGoogleWorkspaceAccessToken;
  now?: () => Date;
  observe?: typeof observeGoogleWorkweek;
  ownerProfileId: string;
  serviceSupabase: SupabaseClient;
  versionId: string;
}): Promise<{ state: "clear" | "google_only" | "conflict"; conflict?: { id: string; conflictRevision: number } }> {
  const versionResponse = await serviceSupabase
    .from("team_workweek_versions")
    .select("id,owner_profile_id,effective_from,origin,team_workweek_windows(weekday,start_minute,end_minute)")
    .eq("id", versionId)
    .eq("owner_profile_id", ownerProfileId)
    .maybeSingle<VersionRow>();
  if (versionResponse.error || !versionResponse.data) throw new TeamWorkweekConflictError("not_found", "Private Grundwoche wurde nicht gefunden.");
  if (versionResponse.data.origin !== "owner") return { state: "clear" };

  let current: Awaited<ReturnType<typeof observeCurrentGoogle>>;
  try {
    current = await observeCurrentGoogle({ getAccessToken, now, observe, ownerProfileId, serviceSupabase });
  } catch (error) {
    if (error instanceof TeamWorkweekConflictError && error.code === "not_found") return { state: "clear" };
    throw error;
  }
  if (current.observation.state === "unchanged") {
    const confirmed = await serviceSupabase.rpc("apply_google_team_workweek_observations", {
      p_publication_id: current.publication.id,
      p_expected_publication_revision: current.publication.publication_revision,
      p_observations: current.observation.observations,
      p_observed_at: current.observation.observedAt,
    });
    if (confirmed.error?.code === "P0004") {
      throw new TeamWorkweekConflictError("stale", "Google-Stand wurde während der Prüfung erneut geändert.");
    }
    if (confirmed.error) {
      throw new TeamWorkweekConflictError("unavailable", "Google-Beobachtung konnte nicht bestätigt werden.");
    }
    return { state: "clear" };
  }

  const founderopsWindows = versionWindows(versionResponse.data);
  const founderopsChanged = JSON.stringify(founderopsWindows) !== JSON.stringify(canonicalWindows(current.publication.windows || []));
  if (!founderopsChanged) return { state: "google_only" };

  const googleFingerprint = observationFingerprint(current.observation.observations);
  const founderopsFingerprint = fingerprint({ effectiveFrom: versionResponse.data.effective_from, windows: founderopsWindows });
  const created = await serviceSupabase.rpc("create_team_workweek_google_conflict", {
    p_owner_profile_id: ownerProfileId,
    p_base_publication_id: current.publication.id,
    p_base_publication_revision: current.publication.publication_revision,
    p_founderops_version_id: versionResponse.data.id,
    p_google_effective_from: nextVersionMondayIso(current.publication.effective_from, now()),
    p_google_windows: current.observation.windows,
    p_google_observations: current.observation.observations,
    p_google_fingerprint: googleFingerprint,
    p_founderops_fingerprint: founderopsFingerprint,
    p_observed_at: current.observation.observedAt,
  });
  if (created.error || !created.data?.id) throw new TeamWorkweekConflictError("unavailable", "Synchronisationskonflikt konnte nicht gespeichert werden.");
  return { state: "conflict", conflict: created.data };
}

function conflictView(row: ConflictRow): TeamWorkweekConflictView {
  const founderopsVersion = firstRelation(row.team_workweek_versions);
  return {
    id: row.id,
    conflictRevision: row.conflict_revision,
    state: row.state === "resolved" ? "resolving" : row.state,
    decision: row.decision,
    observedAt: row.observed_at,
    founderops: { effectiveFrom: founderopsVersion.effective_from, windows: versionWindows(founderopsVersion) },
    google: { effectiveFrom: row.google_effective_from, windows: canonicalWindows(row.google_windows) },
  };
}

export async function getOpenTeamWorkweekConflict(serviceSupabase: SupabaseClient, ownerProfileId: string) {
  const response = await serviceSupabase
    .from("team_workweek_google_conflicts")
    .select("id,owner_profile_id,base_publication_id,base_publication_revision,founderops_version_id,google_effective_from,google_windows,google_observations,google_fingerprint,founderops_fingerprint,conflict_revision,state,decision,resolution_version_id,observed_at,team_workweek_versions!team_workweek_google_conflicts_founderops_version_id_fkey(id,owner_profile_id,effective_from,origin,team_workweek_windows(weekday,start_minute,end_minute))")
    .eq("owner_profile_id", ownerProfileId)
    .in("state", ["open", "resolving"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ConflictRow>();
  if (response.error) throw new TeamWorkweekConflictError("unavailable", "Synchronisationskonflikt ist nicht verfügbar.");
  return response.data ? conflictView(response.data) : null;
}

export async function resolveTeamWorkweekConflict({
  conflictId,
  conflictRevision,
  decision,
  getAccessToken = getGoogleWorkspaceAccessToken,
  now = () => new Date(),
  observe = observeGoogleWorkweek,
  ownerProfileId,
  publish = publishTeamWorkweek,
  serviceSupabase,
  userSupabase,
}: {
  conflictId: string;
  conflictRevision: number;
  decision: "founderops" | "google";
  getAccessToken?: typeof getGoogleWorkspaceAccessToken;
  now?: () => Date;
  observe?: typeof observeGoogleWorkweek;
  ownerProfileId: string;
  publish?: typeof publishTeamWorkweek;
  serviceSupabase: SupabaseClient;
  userSupabase: SupabaseClient;
}) {
  const conflictResponse = await serviceSupabase
    .from("team_workweek_google_conflicts")
    .select("id,owner_profile_id,base_publication_id,base_publication_revision,founderops_version_id,google_effective_from,google_windows,google_observations,google_fingerprint,founderops_fingerprint,conflict_revision,state,decision,resolution_version_id,observed_at,team_workweek_versions!team_workweek_google_conflicts_founderops_version_id_fkey(id,owner_profile_id,effective_from,origin,team_workweek_windows(weekday,start_minute,end_minute))")
    .eq("id", conflictId)
    .eq("owner_profile_id", ownerProfileId)
    .maybeSingle<ConflictRow>();
  if (conflictResponse.error || !conflictResponse.data) throw new TeamWorkweekConflictError("not_found", "Synchronisationskonflikt wurde nicht gefunden.");
  const conflict = conflictResponse.data;
  if (conflict.conflict_revision !== conflictRevision) throw new TeamWorkweekConflictError("stale", "Konfliktentscheidung ist veraltet.");

  const founderopsVersion = firstRelation(conflict.team_workweek_versions);
  const currentFounderopsFingerprint = fingerprint({
    effectiveFrom: founderopsVersion.effective_from,
    windows: versionWindows(founderopsVersion),
  });
  if (currentFounderopsFingerprint !== conflict.founderops_fingerprint) {
    throw new TeamWorkweekConflictError("stale", "FounderOps-Stand wurde nach der Konflikterkennung geändert.");
  }

  const current = await observeCurrentGoogle({ getAccessToken, now, observe, ownerProfileId, serviceSupabase });
  let versionId = conflict.resolution_version_id;
  if (!versionId) {
    if (current.publication.id !== conflict.base_publication_id || current.observation.state !== "changed") {
      throw new TeamWorkweekConflictError("stale", "Google- oder FounderOps-Stand wurde zwischenzeitlich geändert.");
    }
    const googleFingerprint = observationFingerprint(current.observation.observations);
    if (googleFingerprint !== conflict.google_fingerprint) {
      throw new TeamWorkweekConflictError("stale", "Google-Stand wurde nach der Konflikterkennung erneut geändert.");
    }
    const resolutionFingerprint = fingerprint({ conflictId, conflictRevision, decision, googleFingerprint });
    const prepared = await serviceSupabase.rpc("prepare_team_workweek_google_conflict_resolution", {
      p_conflict_id: conflictId,
      p_owner_profile_id: ownerProfileId,
      p_conflict_revision: conflictRevision,
      p_decision: decision,
      p_google_observations: current.observation.observations,
      p_google_fingerprint: googleFingerprint,
      p_founderops_fingerprint: currentFounderopsFingerprint,
      p_resolution_fingerprint: resolutionFingerprint,
      p_observed_at: current.observation.observedAt,
    });
    if (prepared.error?.code === "P0004") throw new TeamWorkweekConflictError("stale", "Konfliktentscheidung ist veraltet.");
    if (prepared.error || typeof prepared.data?.versionId !== "string") throw new TeamWorkweekConflictError("unavailable", "Konfliktauflösung konnte nicht vorbereitet werden.");
    versionId = prepared.data.versionId;
  } else {
    if (conflict.decision !== decision) {
      throw new TeamWorkweekConflictError("stale", "Konflikt wurde bereits anders entschieden.");
    }
    if (current.publication.id !== conflict.base_publication_id) {
      throw new TeamWorkweekConflictError("stale", "Bestätigter FounderOps-Stand wurde zwischenzeitlich geändert.");
    }
    const googleFingerprint = observationFingerprint(current.observation.observations);
    if (googleFingerprint !== conflict.google_fingerprint) {
      const refreshed = await serviceSupabase.rpc("refresh_team_workweek_google_conflict_resolution", {
        p_conflict_id: conflictId,
        p_owner_profile_id: ownerProfileId,
        p_conflict_revision: conflictRevision,
        p_decision: decision,
        p_google_observations: current.observation.observations,
        p_google_fingerprint: googleFingerprint,
        p_observed_at: current.observation.observedAt,
      });
      if (refreshed.error) {
        throw new TeamWorkweekConflictError("unavailable", "Geänderte Google-Basis konnte nicht neu bestätigt werden.");
      }
      throw new TeamWorkweekConflictError("stale", "Google wurde erneut geändert. Prüfe die gewählte Variante und bestätige sie erneut.");
    }
  }

  if (!versionId) throw new TeamWorkweekConflictError("unavailable", "Konfliktauflösung ist unvollständig.");
  const publication = await publish({ serviceSupabase, userSupabase, versionId, now, transitionsFirst: true });
  if (publication.status === "published") {
    const completed = await serviceSupabase.rpc("complete_team_workweek_google_conflict_resolution", {
      p_conflict_id: conflictId,
      p_owner_profile_id: ownerProfileId,
      p_conflict_revision: conflictRevision,
      p_resolved_at: publication.lastSyncAt || now().toISOString(),
    });
    if (completed.error) throw new TeamWorkweekConflictError("unavailable", "Bestätigte Konfliktauflösung konnte nicht abgeschlossen werden.");
  }
  return publication;
}
