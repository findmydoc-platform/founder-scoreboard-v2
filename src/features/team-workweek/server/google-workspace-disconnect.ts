import type { NextRequest } from "next/server";
import type { GoogleCalendarCapability } from "@/lib/credentials";
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { nextMondayIso } from "../model/team-workweek-draft";
import { GoogleWorkspaceOAuthContractError } from "@/lib/google-calendar-errors";
import { calendarForWorkweekOwner, removeWorkweekCalendarConnection } from "./team-workweek-calendar";
import {
  ensureGoogleWorkweekSeriesAbsent,
  observeGoogleWorkweekSeriesForDisconnect,
} from "./google-workspace-disconnect-core";
import { ensureGoogleWorkweekSeriesTransition } from "./team-workweek-publication-core";
import { cleanupGoogleWorkweekEffect, type PreparedWorkweekEffect } from "./team-workweek-immediate-effects";
import { compensateTeamWorkweekGeneration } from "./team-workweek-execution";

type DisconnectOperationRow = Readonly<{
  id: string;
  owner_profile_id: string;
  requested_by: "owner" | "external_revocation";
  revoke_connection: boolean;
  state: "cleaning" | "cleanup_pending" | "revoke_pending" | "completed";
  retained_version_id: string | null;
  deactivated_at: string | null;
  completed_at: string | null;
  last_error_class: string | null;
}>;

type DisconnectTargetRow = Readonly<{
  id: string;
  series_id: string;
  calendar_id: "primary";
  google_event_id: string;
  expected_etag: string;
  expected_founderops_revision: number;
  cleanup_action: "delete" | "truncate";
  recurrence_count: number | null;
  state: "pending" | "confirmed";
  effect_plan?: PreparedWorkweekEffect | null;
}>;

export type GoogleWorkspaceDisconnectView = Readonly<{
  state: "idle" | "cleaning" | "cleanup_pending" | "remove_pending" | "completed";
  activePublicationCount: number;
  futureSeriesCount: number;
  pendingSeriesCount: number;
  teamVisibilityWillBeDisabled: boolean;
}>;

export class GoogleWorkspaceDisconnectError extends Error {
  constructor(readonly code: "conflict" | "unavailable", message: string) {
    super(message);
    this.name = "GoogleWorkspaceDisconnectError";
  }
}

async function openOperation(serviceSupabase: SupabaseClient, ownerProfileId: string) {
  const response = await serviceSupabase
    .from("google_workspace_disconnect_operations")
    .select("id,owner_profile_id,requested_by,revoke_connection,state,retained_version_id,deactivated_at,completed_at,last_error_class")
    .eq("owner_profile_id", ownerProfileId)
    .neq("state", "completed")
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle<DisconnectOperationRow>();
  if (response.error) throw new GoogleWorkspaceDisconnectError("unavailable", "Trennungsstatus ist nicht verfügbar.");
  return response.data;
}

async function targets(serviceSupabase: SupabaseClient, operationId: string) {
  const response = await serviceSupabase
    .from("google_workspace_disconnect_series")
    .select("id,series_id,calendar_id,google_event_id,expected_etag,expected_founderops_revision,cleanup_action,recurrence_count,state,effect_plan")
    .eq("operation_id", operationId)
    .order("google_event_id", { ascending: true })
    .returns<DisconnectTargetRow[]>();
  if (response.error) throw new GoogleWorkspaceDisconnectError("unavailable", "Kalenderbereinigung ist nicht verfügbar.");
  return response.data || [];
}

export async function getGoogleWorkspaceDisconnectView(
  serviceSupabase: SupabaseClient,
  ownerProfileId: string,
  now = () => new Date(),
): Promise<GoogleWorkspaceDisconnectView> {
  const [publicationResponse, operation] = await Promise.all([
    serviceSupabase
      .from("team_workweek_publications")
      .select("id,effective_from,effective_to")
      .eq("owner_profile_id", ownerProfileId)
      .eq("status", "published"),
    openOperation(serviceSupabase, ownerProfileId),
  ]);
  if (publicationResponse.error) {
    throw new GoogleWorkspaceDisconnectError("unavailable", "Trennungsvorschau ist nicht verfügbar.");
  }
  const operationTargets = operation ? await targets(serviceSupabase, operation.id) : [];
  const publications = publicationResponse.data || [];
  const cutoff = nextMondayIso(now());
  const futurePublicationIds = publications
    .filter((publication) => publication.effective_to === null || publication.effective_to >= cutoff)
    .map((publication) => publication.id);
  let futureSeriesCount = 0;
  if (!operation && futurePublicationIds.length > 0) {
    const seriesResponse = await serviceSupabase
      .from("team_workweek_google_series")
      .select("id", { count: "exact", head: true })
      .eq("owner_profile_id", ownerProfileId)
      .in("publication_id", futurePublicationIds)
      .eq("state", "confirmed")
      .eq("provider_state", "active")
      .neq("future_cleanup_state", "confirmed");
    if (seriesResponse.error) {
      throw new GoogleWorkspaceDisconnectError("unavailable", "Trennungsvorschau ist nicht verfügbar.");
    }
    futureSeriesCount = seriesResponse.count || 0;
  }
  const pendingSeriesCount = operationTargets.filter((target) => target.state === "pending").length;
  return {
    state: operation?.state === "revoke_pending" ? "remove_pending" : operation?.state || "idle",
    activePublicationCount: publications.length,
    futureSeriesCount: operation ? operationTargets.length : futureSeriesCount,
    pendingSeriesCount,
    teamVisibilityWillBeDisabled: publications.length > 0,
  };
}

export async function markTeamWorkweekExternalRevocation({
  excludedPublicationId = null,
  now = () => new Date(),
  ownerProfileId,
  serviceSupabase,
}: {
  excludedPublicationId?: string | null;
  now?: () => Date;
  ownerProfileId: string;
  serviceSupabase: SupabaseClient;
}) {
  const response = await serviceSupabase.rpc("deactivate_team_workweek_for_external_revocation", {
    p_owner_profile_id: ownerProfileId,
    p_excluded_publication_id: excludedPublicationId,
    p_observed_at: now().toISOString(),
  });
  if (response.error) {
    throw new GoogleWorkspaceDisconnectError("unavailable", "Extern widerrufene Grundwoche konnte nicht deaktiviert werden.");
  }
  return response.data;
}

async function recordDelay(
  serviceSupabase: SupabaseClient,
  operationId: string,
  targetId: string,
  errorClass: string,
  observedAt: string,
) {
  const [targetResponse, operationResponse] = await Promise.all([
    serviceSupabase.from("google_workspace_disconnect_series").update({
      last_error_class: errorClass,
      last_observed_at: observedAt,
      updated_at: observedAt,
    }).eq("id", targetId).eq("state", "pending"),
    serviceSupabase.from("google_workspace_disconnect_operations").update({
      last_error_class: errorClass,
      updated_at: observedAt,
    }).eq("id", operationId),
  ]);
  if (targetResponse.error || operationResponse.error) {
    throw new GoogleWorkspaceDisconnectError("unavailable", "Verzögerte Kalenderbereinigung konnte nicht gespeichert werden.");
  }
}

async function cleanupOperation({
  accessToken,
  ensureAbsent,
  ensureTransition,
  now,
  observe,
  operation,
  serviceSupabase,
}: {
  accessToken: GoogleCalendarCapability;
  ensureAbsent: typeof ensureGoogleWorkweekSeriesAbsent;
  ensureTransition: typeof ensureGoogleWorkweekSeriesTransition;
  now: () => Date;
  observe: typeof observeGoogleWorkweekSeriesForDisconnect;
  operation: DisconnectOperationRow;
  serviceSupabase: SupabaseClient;
}) {
  const operationTargets = await targets(serviceSupabase, operation.id);
  for (const target of operationTargets) {
    if (target.state === "confirmed") continue;
    if(target.effect_plan){
      const result=await cleanupGoogleWorkweekEffect({accessToken,effect:target.effect_plan,now});
      if(result.state==="delayed"){
        await recordDelay(serviceSupabase,operation.id,target.id,result.errorClass,now().toISOString());
        return result.errorClass;
      }
      const confirmation=await serviceSupabase.rpc("confirm_google_workspace_disconnect_series",{p_target_id:target.id,p_expected_etag:target.expected_etag,p_confirmed_etag:result.etag,p_observed_at:result.observedAt});
      if(confirmation.error)throw new GoogleWorkspaceDisconnectError("conflict","Physische Kalenderbereinigung konnte nicht bestätigt werden.");
      continue;
    }
    const identity = {
      calendarId: target.calendar_id,
      googleEventId: target.google_event_id,
      seriesId: target.series_id,
      expectedEtag: target.expected_etag,
      expectedFounderopsRevision: target.expected_founderops_revision,
    } as const;
    const observed = await observe({ accessToken, target: identity });
    if (observed.state === "delayed") {
      await recordDelay(serviceSupabase, operation.id, target.id, observed.errorClass, now().toISOString());
      return observed.errorClass;
    }
    if (observed.state === "present" && observed.etag !== target.expected_etag) {
      const rebased = await serviceSupabase.rpc("rebase_google_workspace_disconnect_series", {
        p_target_id: target.id,
        p_expected_etag: target.expected_etag,
        p_observed_etag: observed.etag,
        p_observed_at: now().toISOString(),
      });
      if (rebased.error) throw new GoogleWorkspaceDisconnectError("conflict", "Kalenderserie wurde während der Trennung erneut geändert.");
      return "provider_rebased";
    }
    if (observed.state === "absent") {
      const confirmed = await serviceSupabase.rpc("confirm_google_workspace_disconnect_series", {
        p_target_id: target.id,
        p_expected_etag: target.expected_etag,
        p_confirmed_etag: "",
        p_observed_at: now().toISOString(),
      });
      if (confirmed.error) throw new GoogleWorkspaceDisconnectError("conflict", "Kalenderserie wurde während der Trennung geändert.");
      continue;
    }
    const result = target.cleanup_action === "delete"
      ? await ensureAbsent({
        accessToken,
        now,
        target: identity,
      })
      : await ensureTransition({
        accessToken,
        now,
        transition: {
          id: target.id,
          calendarId: target.calendar_id,
          googleEventId: target.google_event_id,
          predecessorSeriesId: target.series_id,
          state: "pending",
          expectedEtag: target.expected_etag,
          expectedFounderopsRevision: target.expected_founderops_revision,
          recurrenceCount: target.recurrence_count || 1,
          confirmedEtag: null,
        },
      });
    if (result.state === "delayed") {
      await recordDelay(serviceSupabase, operation.id, target.id, result.errorClass, now().toISOString());
      return result.errorClass;
    }
    const confirmed = await serviceSupabase.rpc("confirm_google_workspace_disconnect_series", {
      p_target_id: target.id,
      p_expected_etag: target.expected_etag,
      p_confirmed_etag: target.cleanup_action === "delete" ? "" : result.etag,
      p_observed_at: result.observedAt,
    });
    if (confirmed.error) throw new GoogleWorkspaceDisconnectError("conflict", "Kalenderserie wurde während der Trennung geändert.");
  }
  return null;
}

export async function disconnectGoogleWorkspace({
  request,
  ensureAbsent = ensureGoogleWorkweekSeriesAbsent,
  ensureTransition = ensureGoogleWorkweekSeriesTransition,
  getAccessToken = calendarForWorkweekOwner,
  now = () => new Date(),
  observe = observeGoogleWorkweekSeriesForDisconnect,
  ownerProfileId,
  removeConnection = removeWorkweekCalendarConnection,
  serviceSupabase,
}: {
  ensureAbsent?: typeof ensureGoogleWorkweekSeriesAbsent;
  ensureTransition?: typeof ensureGoogleWorkweekSeriesTransition;
  request?: NextRequest;
  getAccessToken?: typeof calendarForWorkweekOwner;
  now?: () => Date;
  observe?: typeof observeGoogleWorkweekSeriesForDisconnect;
  ownerProfileId: string;
  removeConnection?: typeof removeWorkweekCalendarConnection;
  serviceSupabase: SupabaseClient;
}) {
  let operation = await openOperation(serviceSupabase, ownerProfileId);
  if (!operation || operation.state==="cleaning" || operation.state==="cleanup_pending") {
    const pending=await serviceSupabase.from("team_workweek_publications").select("id,attempt_generation,effective_at").eq("owner_profile_id",ownerProfileId).eq("status","preparing");
    if(pending.error)throw new GoogleWorkspaceDisconnectError("unavailable","Laufende Veröffentlichung konnte nicht geprüft werden.");
    for(const publication of pending.data||[]){
      if(!publication.attempt_generation || !publication.effective_at || Date.parse(publication.effective_at)>now().getTime())throw new GoogleWorkspaceDisconnectError("conflict","Schließe zuerst die laufende Veröffentlichung ab.");
      let accessToken:GoogleCalendarCapability;
      try{accessToken=await getAccessToken(serviceSupabase,ownerProfileId,request);}catch{return {state:"cleanup_pending" as const,recovery:"reconnect" as const};}
      const failure=await compensateTeamWorkweekGeneration({accessToken,publicationId:publication.id,generation:publication.attempt_generation,serviceSupabase,now});
      if(failure)return {state:"cleanup_pending" as const,recovery:failure==="oauth_reconnect_required"?"reconnect" as const:"retry" as const};
      const retired=await serviceSupabase.rpc("retire_compensated_workweek_for_disconnect",{p_owner_profile_id:ownerProfileId,p_publication_id:publication.id,p_generation:publication.attempt_generation});
      if(retired.error)throw new GoogleWorkspaceDisconnectError("conflict","Bereinigte Veröffentlichung konnte noch nicht abgeschlossen werden.");
    }
  }
  if (!operation || ((operation.state==="cleaning" || operation.state==="cleanup_pending") && !(await targets(serviceSupabase,operation.id)).length)) {
    const prepared = await serviceSupabase.rpc("prepare_google_workspace_disconnect", {
      p_owner_profile_id: ownerProfileId,
    });
    if (prepared.error?.code === "P0003") {
      throw new GoogleWorkspaceDisconnectError("conflict", "Schließe zuerst den laufenden Wochenabgleich ab.");
    }
    if (prepared.error) throw new GoogleWorkspaceDisconnectError("unavailable", "Trennung konnte nicht vorbereitet werden.");
    if (prepared.data?.state === "completed") return { state: "completed" as const, recovery: null };
    operation = await openOperation(serviceSupabase, ownerProfileId);
  }
  if (!operation) throw new GoogleWorkspaceDisconnectError("unavailable", "Trennung konnte nicht geladen werden.");

  if (operation.state === "cleaning" || operation.state === "cleanup_pending") {
    let accessToken: GoogleCalendarCapability;
    try {
      accessToken = await getAccessToken(serviceSupabase, ownerProfileId, request);
    } catch (error) {
      if (error instanceof GoogleWorkspaceOAuthContractError && error.code === "provider_revoked") {
        await markTeamWorkweekExternalRevocation({ ownerProfileId, serviceSupabase, now });
        return { state: "cleanup_pending" as const, recovery: "reconnect" as const };
      }
      if (error instanceof GoogleWorkspaceOAuthContractError && error.code === "reconnect_required") {
        return { state: operation.state, recovery: "reconnect" as const };
      }
      return { state: operation.state, recovery: "retry" as const };
    }
    const delayed = await cleanupOperation({ accessToken, ensureAbsent, ensureTransition, now, observe, operation, serviceSupabase });
    if (delayed === "oauth_reconnect_required") {
      return { state: operation.state, recovery: "reconnect" as const };
    }
    if (delayed) return { state: operation.state, recovery: "retry" as const };
    const finalized = await serviceSupabase.rpc("finalize_google_workspace_disconnect", {
      p_operation_id: operation.id,
      p_owner_profile_id: ownerProfileId,
      p_observed_at: now().toISOString(),
    });
    if (finalized.error) throw new GoogleWorkspaceDisconnectError("unavailable", "Trennung konnte nicht bestätigt werden.");
    operation = await openOperation(serviceSupabase, ownerProfileId) || { ...operation, state: finalized.data?.state || "completed" };
  }

  if (operation.state === "revoke_pending") {
    try {
      await removeConnection(serviceSupabase, ownerProfileId, request, operation.id);
    } catch {
      return { state: "remove_pending" as const, recovery: "retry" as const };
    }
    const completed = await serviceSupabase.rpc("complete_google_workspace_disconnect", {
      p_operation_id: operation.id,
      p_owner_profile_id: ownerProfileId,
      p_completed_at: now().toISOString(),
    });
    if (completed.error) throw new GoogleWorkspaceDisconnectError("unavailable", "Google-Verbindung wurde lokal entfernt, aber die Trennung ist noch nicht abgeschlossen.");
  }
  return { state: "completed" as const, recovery: null };
}
