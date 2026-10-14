import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { berlinCivilInstant } from "../model/team-workweek-calendar";
import type { KnownGoogleWorkweekSeries, KnownGoogleWorkweekWindow } from "./team-workweek-reconciliation-core";
import type { WorkweekGooglePayload } from "./team-workweek-immediate-effects";

export type ObservationPublication = Readonly<{
  id: string; source_version_id: string; owner_profile_id: string; effective_from: string;
  effective_to?: string | null; effective_at?: string | null; effective_until?: string | null;
  attempt_generation?: number; publication_revision: number; last_sync_at: string | null;
  windows: Array<{weekday:number;startMinute:number;endMinute:number}>;
}>;

export async function loadTeamWorkweekObservationContext(supabase: SupabaseClient, owner: string, now: Date) {
  const publications = await supabase.from("team_workweek_publications")
    .select("id,source_version_id,owner_profile_id,effective_from,effective_to,effective_at,effective_until,attempt_generation,publication_revision,last_sync_at,windows")
    .eq("owner_profile_id",owner).eq("status","published").order("effective_from",{ascending:false}).order("publication_revision",{ascending:false})
    .returns<ObservationPublication[]>();
  if(publications.error) throw new Error("Confirmed workweek is unavailable.");
  const starts=(p:ObservationPublication)=>p.effective_at?Date.parse(p.effective_at):berlinCivilInstant(p.effective_from,"00:00");
  const ends=(p:ObservationPublication)=>p.effective_until?Date.parse(p.effective_until):p.effective_to?berlinCivilInstant(new Date(Date.parse(`${p.effective_to}T00:00:00Z`)+86400000).toISOString().slice(0,10),"00:00"):Infinity;
  const publication=(publications.data || []).filter(p=>starts(p)<=now.getTime() && ends(p)>now.getTime()).sort((a,b)=>starts(b)-starts(a)||b.publication_revision-a.publication_revision)[0];
  if(!publication) return null;
  const seriesResponse=await supabase.from("team_workweek_google_series")
    .select("id,source_window_id,source_window_ids,projection_part,calendar_id,google_event_id,confirmed_etag,confirmed_founderops_revision,provider_state,observed_payload,team_workweek_windows!inner(weekday,start_minute,end_minute)")
    .eq("publication_id",publication.id).eq("state","confirmed").eq("provider_state","active").order("id",{ascending:true});
  if(seriesResponse.error) throw new Error("Managed Google mappings are unavailable.");
  const rows=(seriesResponse.data || []) as Array<{id:string;source_window_id?:number;source_window_ids?:number[];projection_part?:string;calendar_id:"primary";google_event_id:string;confirmed_etag:string;confirmed_founderops_revision:number;provider_state:string;observed_payload?:WorkweekGooglePayload|null;team_workweek_windows:{weekday:number;start_minute:number;end_minute:number}|Array<{weekday:number;start_minute:number;end_minute:number}>}>;
  const physical=Boolean(publication.attempt_generation || publication.effective_until || rows.some(row=>row.observed_payload));
  let partialGoogleState=false;
  let logicalWindows:KnownGoogleWorkweekWindow[]|undefined;
  const payloads=new Map<string,WorkweekGooglePayload>();
  if(physical){
    const windows=await supabase.from("team_workweek_windows").select("id,weekday,start_minute,end_minute").eq("version_id",publication.source_version_id);
    if(windows.error) throw new Error("Logical workweek sources are unavailable.");
    logicalWindows=(windows.data || []).map(row=>({id:String(row.id),weekday:row.weekday,startMinute:row.start_minute,endMinute:row.end_minute}));
    if(rows.length){
      const partial=await supabase.from("team_workweek_publication_effects").select("id").in("series_id",rows.map(row=>row.id)).eq("cleanup_preserved",true).eq("cleanup_disposition","retain").limit(1);
      if(partial.error)throw new Error("Physical cleanup evidence is unavailable.");
      partialGoogleState=Boolean(partial.data?.length);
      const effects=await supabase.from("team_workweek_publication_effects").select("series_id,payload,observed_at,id")
        .in("series_id",rows.map(row=>row.id)).eq("state","confirmed").in("kind",["weekly","predecessor_cutoff"])
        .order("observed_at",{ascending:false}).order("id",{ascending:false});
      if(effects.error) throw new Error("Confirmed physical workweek plan is unavailable.");
      for(const effect of effects.data || []) if(!payloads.has(effect.series_id)) payloads.set(effect.series_id,effect.payload as WorkweekGooglePayload);
      const legacyRows=rows.filter(row=>!row.observed_payload && !payloads.has(row.id));
      if(legacyRows.length){
        const transitions=await supabase.from("team_workweek_google_series_transitions").select("predecessor_series_id,recurrence_count,last_confirmed_at,id").in("predecessor_series_id",legacyRows.map(row=>row.id)).eq("state","confirmed").order("last_confirmed_at",{ascending:false}).order("id",{ascending:false});
        if(transitions.error)throw new Error("Legacy physical boundaries are unavailable.");
        for(const row of legacyRows){
          const window=Array.isArray(row.team_workweek_windows)?row.team_workweek_windows[0]:row.team_workweek_windows;
          if(!window)throw new Error("Legacy workweek window is unavailable.");
          const firstDate=new Date(Date.parse(`${publication.effective_from}T00:00:00Z`)+(window.weekday-1)*86_400_000).toISOString().slice(0,10);
          const clock=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;
          const transition=transitions.data?.find(item=>item.predecessor_series_id===row.id);
          payloads.set(row.id,{id:row.google_event_id,start:{dateTime:new Date(berlinCivilInstant(firstDate,clock(window.start_minute))).toISOString(),timeZone:"Europe/Berlin"},end:{dateTime:new Date(berlinCivilInstant(firstDate,clock(window.end_minute))).toISOString(),timeZone:"Europe/Berlin"},recurrence:[`RRULE:FREQ=WEEKLY${transition?`;COUNT=${transition.recurrence_count}`:""}`],extendedProperties:{private:{founderopsWorkweekSeriesId:row.id,founderopsWorkweekRevision:String(row.confirmed_founderops_revision)}}});
        }
      }
    }
  }
  const series:KnownGoogleWorkweekSeries[]=[];
  for(const row of rows){
    const window=Array.isArray(row.team_workweek_windows)?row.team_workweek_windows[0]:row.team_workweek_windows;
    if(!row.confirmed_etag || !row.confirmed_founderops_revision || !window) throw new Error("Managed series observation is incomplete.");
    const sourceIds=(row.source_window_ids || [row.source_window_id]).map(String);
    const intendedPayload=row.observed_payload || payloads.get(row.id);
    series.push({id:row.id,calendarId:row.calendar_id,googleEventId:row.google_event_id,confirmedEtag:row.confirmed_etag,confirmedFounderopsRevision:row.confirmed_founderops_revision,
      weekday:window.weekday,startMinute:window.start_minute,endMinute:window.end_minute,
      ...(physical?{projectionPart:row.projection_part || "legacy",logicalSources:logicalWindows!.filter(source=>sourceIds.includes(source.id)),...(intendedPayload?{intendedPayload}:{})}:{})});
  }
  return {publication,series,logicalWindows,partialGoogleState};
}
