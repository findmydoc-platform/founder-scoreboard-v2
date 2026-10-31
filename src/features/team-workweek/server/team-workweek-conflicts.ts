import type { WorkweekBookkeeping } from "./team-workweek-bookkeeping";
import type { NextRequest } from "next/server";
import type { GoogleCalendarCapability } from "@/lib/credentials";
import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTeamWorkweekObservationContext } from "./team-workweek-observation-context";
import { berlinTodayIso, nextVersionMondayIso } from "../model/team-workweek-draft";
import { calendarForWorkweekOwner } from "./team-workweek-calendar";
import {
  observeGoogleWorkweek,
  type GoogleWorkweekObservation,
  type GoogleWorkweekReconciliationResult,
} from "./team-workweek-reconciliation-core";
import { GoogleWorkspaceOAuthContractError } from "@/lib/google-calendar-errors";
import {
  publishTeamWorkweek,
  type TeamWorkweekPublicationDelayClass,
} from "./team-workweek-publication";

type Window = Readonly<{ weekday: number; startMinute: number; endMinute: number }>;

type VersionRow = Readonly<{
  activation_mode?: "immediate" | "future_monday";
  base_publication_id?: string | null;
  selected_week_start?: string | null;
  id: string;
  owner_profile_id: string;
  effective_from: string;
  origin: "owner" | "google_reconciliation";
  team_workweek_windows: Array<{ weekday: number; start_minute: number; end_minute: number }>;
}>;

type ConflictRow = Readonly<{
  google_variant_supported?: boolean;
  app_variant_supported?: boolean;
  founderops_binding_snapshot?: unknown;
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
  founderops: Readonly<{ effectiveFrom: string; windows: Window[]; supported?: boolean; activationMode?: "immediate" | "future_monday" }> ;
  google: Readonly<{ effectiveFrom: string; windows: Window[]; supported?: boolean; activationMode?: "immediate" | "future_monday" }> ;
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

async function loadObservationContext(serviceSupabase:SupabaseClient,ownerProfileId:string,now:Date,publicationId?:string){
  let context:Awaited<ReturnType<typeof loadTeamWorkweekObservationContext>>;
  try {context=await loadTeamWorkweekObservationContext(serviceSupabase,ownerProfileId,now,publicationId);}
  catch {throw new TeamWorkweekConflictError("unavailable","Bestätigte App-Arbeitswoche ist nicht verfügbar.");}
  if(!context) throw new TeamWorkweekConflictError("not_found","Noch keine aktuell gültige App-Arbeitswoche vorhanden.");
  return context;
}

async function observeCurrentGoogle({
  request,
  getAccessToken,
  now,
  observe,
  ownerProfileId,
  serviceSupabase,
  context: providedContext,
}: {
  request?: NextRequest;
  getAccessToken: typeof calendarForWorkweekOwner;
  now: () => Date;
  observe: typeof observeGoogleWorkweek;
  ownerProfileId: string;
  serviceSupabase: SupabaseClient;
  context?: Awaited<ReturnType<typeof loadObservationContext>>;
}) {
  const context = providedContext || await loadObservationContext(serviceSupabase, ownerProfileId,now());
  let accessToken: GoogleCalendarCapability;
  try {
    accessToken = await getAccessToken(serviceSupabase, ownerProfileId, request);
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
  const observation = await observe({ accessToken, now, series: context.series,logicalWindows:context.logicalWindows,verifyKnownPayloads:context.partialGoogleState });
  if (observation.state === "delayed" || (observation.state === "conflict" && !observation.observations)) {
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
  request,
  getAccessToken = calendarForWorkweekOwner,
  now = () => new Date(),
  observe = observeGoogleWorkweek,
  ownerProfileId,
  serviceSupabase,
  versionId,
}: {
  request?: NextRequest;
  getAccessToken?: typeof calendarForWorkweekOwner;
  now?: () => Date;
  observe?: typeof observeGoogleWorkweek;
  ownerProfileId: string;
  serviceSupabase: SupabaseClient;
  versionId: string;
}): Promise<{ state: "clear" | "google_only" | "conflict"; conflict?: { id: string; conflictRevision: number } }> {
  const versionResponse = await serviceSupabase
    .from("team_workweek_versions")
    .select("id,owner_profile_id,effective_from,activation_mode,base_publication_id,selected_week_start,origin,team_workweek_windows(weekday,start_minute,end_minute)")
    .eq("id", versionId)
    .eq("owner_profile_id", ownerProfileId)
    .maybeSingle<VersionRow>();
  if (versionResponse.error || !versionResponse.data) throw new TeamWorkweekConflictError("not_found", "Private Grundwoche wurde nicht gefunden.");
  if (versionResponse.data.origin !== "owner") return { state: "clear" };
  const operation = await serviceSupabase.from("team_workweek_publications")
    .select("id,status,attempt_generation")
    .eq("owner_profile_id", ownerProfileId).eq("source_version_id", versionId)
    .in("status", ["preparing", "published"]).maybeSingle<{id:string;status:string;attempt_generation:number}>();
  if (operation.error) throw new TeamWorkweekConflictError("unavailable", "Veröffentlichungsstatus konnte nicht geladen werden.");
  if (operation.data && operation.data.attempt_generation > 0) return {state:"clear"};


  let current: Awaited<ReturnType<typeof observeCurrentGoogle>>;
  try {
    const context=await loadObservationContext(serviceSupabase,ownerProfileId,now(),versionResponse.data.base_publication_id || undefined);
    // Verify retained physical cutoffs before a fresh owner publication. Partial
    // Google state is neither imported as a template nor reported as confirmed.
    current = await observeCurrentGoogle({ request, getAccessToken, now, observe, ownerProfileId, serviceSupabase,context });
  } catch (error) {
    if (error instanceof TeamWorkweekConflictError && error.code === "not_found") return { state: "clear" };
    throw error;
  }
  if(current.observation.state==="conflict"){
    const conflict=await captureObservedTeamWorkweekConflict(serviceSupabase,ownerProfileId,current.publication,current.observation);
    return {state:"conflict",conflict};
  }
  if (current.observation.state === "unchanged") {
    const confirmed = await serviceSupabase.rpc("apply_google_team_workweek_observations", {
      p_publication_id: current.publication.id,
      p_publication_revision: current.publication.publication_revision,
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
  const futureBase = current.publication.effective_at
    ? Date.parse(current.publication.effective_at) > now().getTime()
    : current.publication.effective_from > berlinTodayIso(now());
  if (!founderopsChanged && !futureBase) return { state: "google_only" };

  const googleFingerprint = observationFingerprint(current.observation.observations || []);
  const founderopsFingerprint = fingerprint({ effectiveFrom: versionResponse.data.effective_from, windows: founderopsWindows });
  const created = await serviceSupabase.rpc("create_team_workweek_google_conflict", {
    p_owner_profile_id: ownerProfileId,
    p_base_publication_id: current.publication.id,
    p_base_publication_revision: current.publication.publication_revision,
    p_founderops_version_id: versionResponse.data.id,
    p_google_effective_from: versionResponse.data.activation_mode === "future_monday"
      ? versionResponse.data.effective_from : nextVersionMondayIso(current.publication.effective_from, now()),
    p_google_windows: current.observation.windows,
    p_google_observations: current.observation.observations || [],
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
    founderops: { effectiveFrom: founderopsVersion.effective_from, windows: versionWindows(founderopsVersion),supported:row.app_variant_supported??true,activationMode:founderopsVersion.activation_mode||"future_monday" },
    google: { effectiveFrom: row.google_effective_from, windows: canonicalWindows(row.google_windows),supported:row.google_variant_supported??true,activationMode:founderopsVersion.selected_week_start && founderopsVersion.activation_mode === "future_monday" && row.google_effective_from === founderopsVersion.effective_from ? "future_monday" : "immediate" },
  };
}

export async function getOpenTeamWorkweekConflict(serviceSupabase: SupabaseClient, ownerProfileId: string) {
  const response = await serviceSupabase
    .from("team_workweek_google_conflicts")
    .select("id,owner_profile_id,base_publication_id,base_publication_revision,founderops_version_id,google_effective_from,google_windows,google_observations,google_fingerprint,founderops_fingerprint,founderops_binding_snapshot,google_variant_supported,app_variant_supported,conflict_revision,state,decision,resolution_version_id,observed_at,team_workweek_versions!team_workweek_google_conflicts_founderops_version_id_fkey(id,owner_profile_id,effective_from,activation_mode,base_publication_id,selected_week_start,origin,team_workweek_windows(weekday,start_minute,end_minute))")
    .eq("owner_profile_id", ownerProfileId)
    .in("state", ["open", "resolving"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ConflictRow>();
  if (response.error) throw new TeamWorkweekConflictError("unavailable", "Synchronisationskonflikt ist nicht verfügbar.");
  return response.data ? conflictView(response.data) : null;
}

export async function resolveTeamWorkweekConflict({
  request,
  bookkeeping,
  conflictId,
  conflictRevision,
  decision,
  getAccessToken = calendarForWorkweekOwner,
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
  request?: NextRequest;
  bookkeeping?: WorkweekBookkeeping;
  getAccessToken?: typeof calendarForWorkweekOwner;
  now?: () => Date;
  observe?: typeof observeGoogleWorkweek;
  ownerProfileId: string;
  publish?: typeof publishTeamWorkweek;
  serviceSupabase: SupabaseClient;
  userSupabase: SupabaseClient;
}) {
  const conflictResponse = await serviceSupabase
    .from("team_workweek_google_conflicts")
    .select("id,owner_profile_id,base_publication_id,base_publication_revision,founderops_version_id,google_effective_from,google_windows,google_observations,google_fingerprint,founderops_fingerprint,founderops_binding_snapshot,google_variant_supported,app_variant_supported,conflict_revision,state,decision,resolution_version_id,observed_at,team_workweek_versions!team_workweek_google_conflicts_founderops_version_id_fkey(id,owner_profile_id,effective_from,activation_mode,base_publication_id,selected_week_start,origin,team_workweek_windows(weekday,start_minute,end_minute))")
    .eq("id", conflictId)
    .eq("owner_profile_id", ownerProfileId)
    .maybeSingle<ConflictRow>();
  if (conflictResponse.error || !conflictResponse.data) throw new TeamWorkweekConflictError("not_found", "Synchronisationskonflikt wurde nicht gefunden.");
  const conflict = conflictResponse.data;
  if (conflict.conflict_revision !== conflictRevision) throw new TeamWorkweekConflictError("stale", "Konfliktentscheidung ist veraltet.");

  const founderopsVersion = firstRelation(conflict.team_workweek_versions);
  const currentFounderopsFingerprint = conflict.founderops_binding_snapshot ? conflict.founderops_fingerprint : fingerprint({
    effectiveFrom: founderopsVersion.effective_from,
    windows: versionWindows(founderopsVersion),
  });
  if (currentFounderopsFingerprint !== conflict.founderops_fingerprint) {
    throw new TeamWorkweekConflictError("stale", "FounderOps-Stand wurde nach der Konflikterkennung geändert.");
  }

  if((decision==="google" && conflict.google_variant_supported===false) || (decision==="founderops" && conflict.app_variant_supported===false)) throw new TeamWorkweekConflictError("stale","Diese Variante lässt sich aus der Google-Änderung nicht sicher übernehmen.");
  if(conflict.resolution_version_id){
    const operation=await serviceSupabase.from("team_workweek_publications").select("id,status,attempt_generation").eq("owner_profile_id",ownerProfileId).eq("source_version_id",conflict.resolution_version_id).in("status",["preparing","published"]).maybeSingle<{attempt_generation:number}>();
    if(operation.error) throw new TeamWorkweekConflictError("unavailable","Auflösungsstatus ist nicht verfügbar.");
    if(operation.data?.attempt_generation){
      if(conflict.decision!==decision) throw new TeamWorkweekConflictError("stale","Konflikt wurde bereits anders entschieden.");
      const publication=await publish({request,bookkeeping,serviceSupabase,userSupabase,versionId:conflict.resolution_version_id,now});
      if(publication.status==="published"){
        const completed=bookkeeping ? await bookkeeping.completeConflict({publicationId:publication.id,conflictId,ownerProfileId,revision:conflictRevision,resolvedAt:publication.lastSyncAt || now().toISOString()}) : await serviceSupabase.rpc("complete_team_workweek_google_conflict_resolution",{p_conflict_id:conflictId,p_owner_profile_id:ownerProfileId,p_conflict_revision:conflictRevision,p_resolved_at:publication.lastSyncAt || now().toISOString()});
        if(completed.error) throw new TeamWorkweekConflictError("unavailable","Bestätigte Konfliktauflösung konnte nicht abgeschlossen werden.");
      }
      return publication;
    }
  }
  const context = await loadObservationContext(serviceSupabase, ownerProfileId, now(), conflict.base_publication_id);
  const current = await observeCurrentGoogle({ request, getAccessToken, now, observe, ownerProfileId, serviceSupabase, context });
  let versionId = conflict.resolution_version_id;
  if (!versionId) {
    if (current.publication.id !== conflict.base_publication_id || !(current.observation.state === "changed" || (current.observation.state==="conflict" && current.observation.observations))) {
      throw new TeamWorkweekConflictError("stale", "Google- oder FounderOps-Stand wurde zwischenzeitlich geändert.");
    }
    const googleFingerprint = observationFingerprint(current.observation.observations || []);
    if (googleFingerprint !== conflict.google_fingerprint) {
      throw new TeamWorkweekConflictError("stale", "Google-Stand wurde nach der Konflikterkennung erneut geändert.");
    }
    const resolutionFingerprint = fingerprint({ conflictId, conflictRevision, decision, googleFingerprint });
    const prepared = await serviceSupabase.rpc("prepare_team_workweek_google_conflict_resolution", {
      p_conflict_id: conflictId,
      p_owner_profile_id: ownerProfileId,
      p_conflict_revision: conflictRevision,
      p_decision: decision,
      p_google_observations: current.observation.observations || [],
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
    const googleFingerprint = observationFingerprint(current.observation.observations || []);
    if (googleFingerprint !== conflict.google_fingerprint) {
      const refreshed = await serviceSupabase.rpc("refresh_team_workweek_google_conflict_resolution", {
        p_conflict_id: conflictId,
        p_owner_profile_id: ownerProfileId,
        p_conflict_revision: conflictRevision,
        p_decision: decision,
        p_google_observations: current.observation.observations || [],
        p_google_fingerprint: googleFingerprint,
        p_observed_at: current.observation.observedAt,
      });
      if (refreshed.error) {
        throw new TeamWorkweekConflictError(refreshed.error.code==="P0004"?"stale":"unavailable", "Google wurde erneut geändert. Bereinige den bisherigen Versuch und prüfe die Variante erneut.");
      }
      throw new TeamWorkweekConflictError("stale", "Google wurde erneut geändert. Prüfe die gewählte Variante und bestätige sie erneut.");
    }
  }

  if (!versionId) throw new TeamWorkweekConflictError("unavailable", "Konfliktauflösung ist unvollständig.");
  const publication = await publish({ request, bookkeeping, serviceSupabase, userSupabase, versionId, now });
  if (publication.status === "published") {
    const completed = bookkeeping ? await bookkeeping.completeConflict({ publicationId: publication.id, conflictId, ownerProfileId, revision: conflictRevision, resolvedAt: publication.lastSyncAt || now().toISOString() }) : await serviceSupabase.rpc("complete_team_workweek_google_conflict_resolution", {
      p_conflict_id: conflictId,
      p_owner_profile_id: ownerProfileId,
      p_conflict_revision: conflictRevision,
      p_resolved_at: publication.lastSyncAt || now().toISOString(),
    });
    if (completed.error) throw new TeamWorkweekConflictError("unavailable", "Bestätigte Konfliktauflösung konnte nicht abgeschlossen werden.");
  }
  return publication;
}

export async function captureObservedTeamWorkweekConflict(serviceSupabase:SupabaseClient,ownerProfileId:string,publication:{id:string;publication_revision:number},observation:Extract<GoogleWorkweekReconciliationResult,{state:"conflict"|"changed"}>){
  if(!observation.observations) throw new TeamWorkweekConflictError("stale","Google-Zuordnung ist nicht eindeutig.");
  const captured=await serviceSupabase.rpc("capture_team_workweek_physical_conflict",{p_owner_profile_id:ownerProfileId,p_base_publication_id:publication.id,p_base_publication_revision:publication.publication_revision,
    p_google_windows:observation.state==="changed"?observation.windows:[],p_google_observations:observation.observations,p_google_fingerprint:observationFingerprint(observation.observations),
    p_google_variant_supported:observation.state==="changed",p_app_variant_supported:observation.state==="changed" || Boolean(observation.appRestoreSupported),p_observed_at:observation.observedAt});
  if(captured.error || !captured.data?.id) throw new TeamWorkweekConflictError("unavailable","Google-Konflikt konnte nicht gespeichert werden.");
  return captured.data as {id:string;conflictRevision:number};
}
