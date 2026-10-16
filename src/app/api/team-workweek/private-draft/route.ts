import { selectedWorkweek, workweekStart } from "@/features/team-workweek/model/team-workweek-week";
import { type NextRequest, NextResponse } from "next/server";
import {
  berlinTodayIso,
  flattenTeamWorkweekWindows,
  inflatePublishedTeamWorkweekWindows,
  inflateTeamWorkweekWindows,
  nextVersionMondayIso,
  validatePrivateTeamWorkweekDraft,
} from "@/features/team-workweek/model/team-workweek-draft";
import { apiError, readJsonPayload, requireApiContext } from "@/lib/api-response";
import { bearerToken, requireTeamMember } from "@/lib/authz";
import { berlinCivilInstant } from "@/features/team-workweek/model/team-workweek-calendar";
import { getSupabaseForToken } from "@/lib/supabase-user";

export const dynamic = "force-dynamic";

type PublicationRow = Readonly<{
  id: string;
  effective_from: string;
  activation_mode?: "immediate" | "future_monday";
  effective_at?: string | null;
  effective_until?: string | null;
  effective_to?: string | null;
  attempt_generation?: number;
  source_version_id?: string;
  superseded_by_publication_id?: string | null;
  team_workweek_google_series?: Array<{id:string;google_event_id:string;confirmed_etag:string|null;state:string;provider_state:string;projection_part:string;source_window_ids:number[]|null}>;
  status: "preparing" | "published";
  sync_state: "pending" | "delayed" | "confirmed";
  publication_revision: number;
  published_at: string | null;
  last_sync_at: string | null;
  windows?: Array<{ weekday: number; startMinute: number; endMinute: number }>;
  team_workweek_google_reconciliation_status: Readonly<{
    state: "confirmed" | "pending" | "delayed" | "conflict";
    last_observed_at: string | null;
  }> | Array<Readonly<{
    state: "confirmed" | "pending" | "delayed" | "conflict";
    last_observed_at: string | null;
  }>> | null;
}>;

type PreparedSuccessorBinding={id:string;revision:number;start:string;until?:string|null;effectiveTo?:string|null;sourceVersionId?:string|null;supersededBy?:string|null;windows?:Array<{weekday:number;startMinute:number;endMinute:number}>;series?:Array<{id:string;googleEventId:string;etag:string|null;state:string;providerState:string;part:string;sources:number[]|null}>};
function successorBindingKey(rows:PreparedSuccessorBinding[], replacedId?: string | null){
  return JSON.stringify([...rows].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||a.id.localeCompare(b.id)).map(row=>[
    row.id,row.revision,Date.parse(row.start),row.until?Date.parse(row.until):null,row.effectiveTo||null,row.sourceVersionId||null,row.supersededBy||null,
    (row.windows||[]).map(window=>[window.weekday,window.startMinute,window.endMinute]),
    [...(row.series||[])].sort((a,b)=>a.id.localeCompare(b.id)).map(series=>[series.id,series.googleEventId,row.id===replacedId?null:series.etag,series.state,series.providerState,series.part,series.sources?.map(String)??null]),
  ]));
}

function publicationPayload(row: PublicationRow | null) {
  const reconciliation = row
    ? Array.isArray(row.team_workweek_google_reconciliation_status)
      ? row.team_workweek_google_reconciliation_status[0]
      : row.team_workweek_google_reconciliation_status
    : null;
  return row ? {
    id: row.id,
    effectiveFrom: row.effective_from,
    ...(row.effective_at ? { effectiveAt: row.effective_at } : {}),
    ...(row.effective_until ? { effectiveUntil:row.effective_until } : {}),
    ...(row.activation_mode ? { activationMode: row.activation_mode } : {}),
    status: row.status,
    syncState: row.sync_state,
    publicationRevision: row.publication_revision,
    publishedAt: row.published_at,
    lastSyncAt: row.last_sync_at,
    googleReconciliationState: reconciliation?.state || "confirmed",
    lastGoogleReconciliationAt: reconciliation?.last_observed_at || null,
  } : null;
}

function authenticatedClient(request: NextRequest) {
  const token = bearerToken(request);
  return token ? getSupabaseForToken(token) : null;
}

export async function GET(request: NextRequest) {
  const context = await requireApiContext(request, requireTeamMember);
  if (!context.ok) return context.response;
  const supabase = authenticatedClient(request);
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);

  const requestedWeek = request.nextUrl.searchParams.get("week");
  if (requestedWeek && !selectedWorkweek(requestedWeek).ok) return apiError("Wähle die aktuelle oder eine zukünftige Woche.", 400);
  const pendingResponse = await supabase.from("team_workweek_publications")
    .select("id,source_version_id,effective_from,effective_at,attempt_generation,write_journal_version,restart_requested_at,last_error_class")
    .eq("owner_profile_id", context.permission.profile!.id)
    .eq("status", "preparing")
    .maybeSingle<{id:string;source_version_id:string;effective_from:string;effective_at:string|null;attempt_generation:number;write_journal_version:number;restart_requested_at:string|null;last_error_class:string|null}>();
  if (pendingResponse.error) return apiError("Offene Veröffentlichung konnte nicht geladen werden.", 503);
  const pending = pendingResponse.data;
  let privateQuery = supabase
    .from("team_workweek_versions")
    .select("id,owner_profile_id,effective_from,selected_week_start,activation_mode,base_publication_id,base_publication_revision,successor_snapshot,timezone,status,created_at,team_workweek_windows(weekday,start_minute,end_minute)")
    .eq("status", "preparing")
    .eq("origin", "owner")
    .is("retired_at",null);
  if (requestedWeek) privateQuery = privateQuery.eq("effective_from", requestedWeek);
  const privateResponse = await privateQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      owner_profile_id: string;
      effective_from: string;
      selected_week_start?: string | null;
      activation_mode?: "immediate" | "future_monday";
      base_publication_id?: string | null;
      base_publication_revision?: number | null;
      successor_snapshot?: PreparedSuccessorBinding[] | null;
      timezone: "Europe/Berlin";
      status: "preparing";
      created_at: string;
      team_workweek_windows: Array<{ weekday: number; start_minute: number; end_minute: number }>;
    }>();
  if (privateResponse.error) return apiError("Private Grundwoche konnte nicht geladen werden.", 503);
  let data = privateResponse.data;

  let publication = data ? await supabase
    .from("team_workweek_publications")
    .select("id,effective_from,activation_mode,effective_at,effective_until,attempt_generation,status,sync_state,publication_revision,published_at,last_sync_at,team_workweek_google_reconciliation_status(state,last_observed_at)")
    .eq("source_version_id", data.id)
    .maybeSingle<PublicationRow>() : null;
  if (publication?.error) return apiError("Private Grundwoche konnte nicht geladen werden.", 503);
  if(data && !publication?.data){
    const conflict=await supabase.from("team_workweek_google_conflicts").select("resolution_version_id").eq("founderops_version_id",data.id).eq("state","resolving").maybeSingle<{resolution_version_id:string}>();
    if(conflict.error)return apiError("Privater Konfliktstatus konnte nicht geladen werden.",503);
    if(conflict.data?.resolution_version_id)publication=await supabase.from("team_workweek_publications").select("id,effective_from,activation_mode,effective_at,effective_until,attempt_generation,status,sync_state,publication_revision,published_at,last_sync_at,team_workweek_google_reconciliation_status(state,last_observed_at)").eq("source_version_id",conflict.data.resolution_version_id).maybeSingle<PublicationRow>();
    if(publication?.error)return apiError("Private Veröffentlichung konnte nicht geladen werden.",503);
  }

  // Automatic reconciliation can outlive its pinned current/successor context.
  // Surface its expired operation through the same explicit owner restart action.
  if (!publication?.data || publication.data.status === "published") {
    const automatic = await supabase.from("team_workweek_publications")
      .select("id,source_version_id,effective_from,activation_mode,effective_at,effective_until,attempt_generation,status,sync_state,publication_revision,published_at,last_sync_at,team_workweek_google_reconciliation_status(state,last_observed_at),team_workweek_versions!team_workweek_publications_source_version_id_fkey!inner(origin)")
      .eq("owner_profile_id", context.permission.profile!.id)
      .eq("status", "preparing")
      .eq("team_workweek_versions.origin", "google_reconciliation")
      .maybeSingle<PublicationRow>();
    if (automatic.error) return apiError("Vorbereiteter Google-Abgleich konnte nicht geladen werden.", 503);
    if (!requestedWeek && automatic.data?.attempt_generation && automatic.data.effective_at && new Date(automatic.data.effective_at) <= new Date()) {
      if (publication?.data?.status === "published") data = null;
      publication = automatic;
      if (!data) {
        const source = await supabase.from("team_workweek_versions")
          .select("id,owner_profile_id,effective_from,selected_week_start,activation_mode,base_publication_id,base_publication_revision,successor_snapshot,timezone,status,created_at,team_workweek_windows(weekday,start_minute,end_minute)")
          .eq("id", automatic.data.source_version_id!)
          .eq("origin", "google_reconciliation")
          .is("retired_at", null)
          .maybeSingle<NonNullable<typeof privateResponse.data>>();
        if (source.error) return apiError("Vorbereitete Arbeitswoche konnte nicht geladen werden.", 503);
        data = source.data;
      }
    }
  }

  const privateVersion = publication?.data?.status === "published" ? null : data;
  const ownerProfileId = context.permission.profile?.id || data?.owner_profile_id || null;
  const latestPublishedResponse = ownerProfileId ? await supabase
    .from("team_workweek_publications")
    .select("id,source_version_id,superseded_by_publication_id,effective_from,effective_to,effective_until,activation_mode,effective_at,status,sync_state,publication_revision,published_at,last_sync_at,windows,team_workweek_google_series(id,google_event_id,confirmed_etag,state,provider_state,projection_part,source_window_ids),team_workweek_google_reconciliation_status(state,last_observed_at)")
    .eq("owner_profile_id", ownerProfileId)
    .eq("status", "published")
    .order("effective_from", { ascending: false })
    .order("publication_revision", { ascending: false })
    .returns<PublicationRow[]>() : null;
  if (latestPublishedResponse?.error) return apiError("Veröffentlichungsstatus konnte nicht geladen werden.", 503);
  const publications = latestPublishedResponse?.data || [];
  const now = new Date();
  const startsAt = (row: PublicationRow) => row.effective_at
    ? new Date(row.effective_at).getTime()
    : berlinCivilInstant(row.effective_from, "00:00");
  const currentPublished = publications.filter((row) => startsAt(row) <= now.getTime()
    && (row.effective_until ? new Date(row.effective_until) > now : !row.effective_to || row.effective_to >= berlinTodayIso(now)))
    .sort((left, right) => right.publication_revision - left.publication_revision)[0] || null;
  const preparedSuccessor = publications.filter((row) => startsAt(row) > now.getTime() && (!row.effective_until || Date.parse(row.effective_until) > startsAt(row)) && (!row.effective_to || row.effective_to >= row.effective_from))
    .sort((left, right) => startsAt(left) - startsAt(right))[0] || null;
  const latestPublished = currentPublished || preparedSuccessor;
  const selectedPoint = privateVersion?.selected_week_start && privateVersion.activation_mode === "future_monday"
    ? berlinCivilInstant(privateVersion.selected_week_start, "00:00") : now.getTime();
  const base = privateVersion?.selected_week_start
    ? publications.filter(row => startsAt(row) <= selectedPoint && (row.effective_until ? Date.parse(row.effective_until) > selectedPoint : !row.effective_to || row.effective_to >= (privateVersion.selected_week_start || berlinTodayIso(now))))
      .sort((left, right) => right.publication_revision - left.publication_revision)[0] || null
    : privateVersion?.activation_mode === "future_monday" ? publications[0] : currentPublished;
  const contextChanged=privateVersion && !publication?.data && (
    (privateVersion.base_publication_id||null)!==(base?.id||null)
    || (privateVersion.base_publication_revision||null)!==(base?.publication_revision||null)
    || (privateVersion.successor_snapshot && successorBindingKey(privateVersion.successor_snapshot, privateVersion.selected_week_start && privateVersion.activation_mode === "future_monday" ? privateVersion.base_publication_id : null)!==successorBindingKey(publications.filter(row=>startsAt(row)>now.getTime()).map(row=>({
      id:row.id,revision:row.publication_revision,start:new Date(startsAt(row)).toISOString(),until:row.effective_until,effectiveTo:row.effective_to,sourceVersionId:row.source_version_id,supersededBy:row.superseded_by_publication_id,windows:row.windows,
      series:row.team_workweek_google_series?.map(series=>({id:series.id,googleEventId:series.google_event_id,etag:series.confirmed_etag,state:series.state,providerState:series.provider_state,part:series.projection_part,sources:series.source_window_ids})),
    })), privateVersion.selected_week_start && privateVersion.activation_mode === "future_monday" ? privateVersion.base_publication_id : null)));

  const selectedWeek = requestedWeek || (privateVersion?.activation_mode === "future_monday" && privateVersion.effective_from >= workweekStart() ? privateVersion.effective_from : workweekStart());
  const weekResponse = await supabase.rpc("team_workweek_edit_context", { p_week_start: selectedWeek });
  if (weekResponse.error) return apiError("Die ausgewählte Arbeitswoche konnte nicht geladen werden.", 503);

  return NextResponse.json({
    pendingPublication: pending ? {
      id: pending.id, sourceVersionId: pending.source_version_id, effectiveFrom: pending.effective_from,
      resumeAllowed: !pending.restart_requested_at && (pending.attempt_generation === 0
        || (pending.write_journal_version === 1 && pending.last_error_class !== "provider_identity_mismatch" && Boolean(pending.effective_at && Date.parse(pending.effective_at) > Date.now()))),
    } : null,
    weekContext: weekResponse.data,
    restartAvailable: Boolean(privateVersion && (contextChanged || (publication?.data?.status === "preparing" && publication.data.attempt_generation && publication.data.effective_at))),
    version: privateVersion ? {
      id: privateVersion.id,
      effectiveFrom: privateVersion.effective_from,
      ...(privateVersion.selected_week_start ? { selectedWeekStart: privateVersion.selected_week_start } : {}),
      ...(privateVersion.base_publication_id ? {basePublicationId:privateVersion.base_publication_id,basePublicationRevision:privateVersion.base_publication_revision} : {}),
      ...(privateVersion.activation_mode ? { activationMode: privateVersion.activation_mode } : {}),
      timezone: privateVersion.timezone,
      status: privateVersion.status,
      createdAt: privateVersion.created_at,
      windows: inflateTeamWorkweekWindows(privateVersion.team_workweek_windows || []),
    } : null,
    publication: privateVersion ? publicationPayload(publication?.data || null) : null,
    latestPublished: publicationPayload(latestPublished),
    preparedSuccessor: publicationPayload(preparedSuccessor),
    immediateAllowed: !preparedSuccessor || startsAt(preparedSuccessor) > Math.floor(now.getTime() / 60_000) * 60_000 + 180_000,
    editBase: currentPublished ? {
      basePublicationId:currentPublished.id,basePublicationRevision:currentPublished.publication_revision,
      windows: inflatePublishedTeamWorkweekWindows(currentPublished.windows || []),
    } : null,
    minimumEffectiveFrom: nextVersionMondayIso(publications[0]?.effective_from || null),
  });
}

export async function POST(request: NextRequest) {
  const context = await requireApiContext(request, requireTeamMember);
  if (!context.ok) return context.response;
  const supabase = authenticatedClient(request);
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);

  const payload = await readJsonPayload<unknown>(request, null);
  const selection = payload && typeof payload === "object" && "selectedWeekStart" in payload
    ? payload as Record<string, unknown> : null;
  let draftInput = payload;
  if (selection) {
    const week = typeof selection.selectedWeekStart === "string" ? selectedWorkweek(selection.selectedWeekStart) : { ok: false as const };
    if (!week.ok || typeof selection.contextToken !== "string" || !/^[a-f0-9]{32}$/.test(selection.contextToken)) {
      return apiError("Wähle eine gültige Woche und lade ihren aktuellen Stand.", 400);
    }
    const { selectedWeekStart: _selectedWeekStart, contextToken: _contextToken, ...legacyInput } = selection;
    void _selectedWeekStart; void _contextToken;
    draftInput = { ...legacyInput, effectiveFrom: week.weekStart, activationMode: week.activationMode };
  }
  const validation = validatePrivateTeamWorkweekDraft(draftInput);
  if (!validation.ok) return apiError(validation.errors[0], 400);

  const { data, error } = selection
    ? await supabase.rpc("create_private_selected_team_workweek_version", { p_week_start: selection.selectedWeekStart, p_windows: flattenTeamWorkweekWindows(validation.draft.windows), p_context_token: selection.contextToken })
    : validation.draft.activationMode === "immediate"
    ? validation.draft.basePublicationId
      ? await supabase.rpc("create_private_current_team_workweek_version", { p_windows: flattenTeamWorkweekWindows(validation.draft.windows),
        p_base_publication_id: validation.draft.basePublicationId, p_base_publication_revision: validation.draft.basePublicationRevision })
      : await supabase.rpc("create_private_immediate_team_workweek_version", { p_windows: flattenTeamWorkweekWindows(validation.draft.windows) })
    : validation.draft.basePublicationId
      ? await supabase.rpc("create_private_monday_team_workweek_version", { p_effective_from:validation.draft.effectiveFrom, p_windows:flattenTeamWorkweekWindows(validation.draft.windows), p_base_publication_id:validation.draft.basePublicationId,p_base_publication_revision:validation.draft.basePublicationRevision })
      : await supabase.rpc("create_private_team_workweek_version", {
      p_effective_from: validation.draft.effectiveFrom,
      p_windows: flattenTeamWorkweekWindows(validation.draft.windows),
    });
  if (error) {
    if (error.code === "P0003" || error.code === "P0004") {
      return NextResponse.json({
        code: error.code === "P0003" ? "publication_pending" : "edit_context_stale",
        error: error.code === "P0003"
          ? "Eine frühere Veröffentlichung ist noch offen. Setze sie zuerst fort; deine Eingaben bleiben erhalten."
          : "Die Ausgangsversion hat sich geändert. Lade den aktuellen Stand; deine Eingaben bleiben erhalten.",
      }, { status: 409 });
    }
    const status = error.code === "22023" ? 400 : error.code === "42501" ? 403 : error.code === "P0003" || error.code === "P0004" ? 409 : 503;
    return apiError(
      status === 400
        ? "Grundwoche ist ungültig."
        : status === 403
          ? "Keine Berechtigung für diese Grundwoche."
          : status === 409
            ? "Die Ausgangsversion hat sich geändert oder ein Abgleich läuft. Lade die Arbeitswoche erneut."
            : "Grundwoche konnte nicht gespeichert werden.",
      status,
    );
  }

  return NextResponse.json({ version: data }, { status: 201 });
}
