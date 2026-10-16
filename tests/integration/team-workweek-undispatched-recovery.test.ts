import { expect, it } from "vitest";
import type pg from "pg";
import { asAuthenticated, captureDatabaseError, withIsolatedLocalDatabase } from "./helpers/local-database";
import { cleanupGoogleWorkweekEffect, ensureGoogleWorkweekEffect, type PreparedWorkweekEffect } from "../../src/features/team-workweek/server/team-workweek-immediate-effects";

const user = "bfa73002-0000-4000-8000-000000000001";
const owner = "undispatched-owner";
async function service<T>(db: pg.Client, action: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.role','service_role',true)");
  await db.query("set local role service_role");
  try { return await action(); } finally { await db.query("reset role").catch(()=>undefined); }
}
async function replacement(db: pg.Client) {
  await db.query("insert into auth.users(id) values($1)", [user]);
  await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,'Owner','viewer')", [owner,user]);
  const week = (await db.query("select (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7)::text as week")).rows[0].week;
  const save = async (windows: unknown) => {
    const context = (await asAuthenticated(db,user,()=>db.query("select public.team_workweek_edit_context($1) as value",[week]))).rows[0].value;
    return (await asAuthenticated(db,user,()=>db.query("select public.create_private_selected_team_workweek_version($1,$2,$3) as value",[week,JSON.stringify(windows),context.contextToken]))).rows[0].value;
  };
  const original = await save([{weekday:1,startMinute:540,endMinute:960}]);
  const first = (await asAuthenticated(db,user,()=>db.query("select public.prepare_team_workweek_publication($1,1) as value",[original.id]))).rows[0].value;
  for (const effect of first.effects) await service(db,()=>db.query("select public.confirm_team_workweek_effect($1,1,'first-etag',$2)",[effect.id,effect.payload]));
  await asAuthenticated(db,user,()=>db.query("select public.finalize_team_workweek_publication($1)",[first.id]));
  const windows = [{weekday:2,startMinute:600,endMinute:900}];
  const draft = await save(windows);
  const publication = (await asAuthenticated(db,user,()=>db.query("select public.prepare_team_workweek_publication($1,1) as value",[draft.id]))).rows[0].value;
  const predecessor: PreparedWorkweekEffect = publication.effects.find((effect: PreparedWorkweekEffect)=>effect.operation!=="create");
  expect(predecessor).toBeTruthy();
  return {first,week,windows,draft,publication,predecessor};
}
const record = (db: pg.Client, operationId: string, effectId: string) => {
  const outcome = (state: string) => service(db,()=>db.query("select public.record_team_workweek_provider_write($1,$2,$3)",[operationId,effectId,state])).then(()=>undefined);
  return {beforeWrite:()=>outcome("dispatched"),outcome};
};

it.each([{deleted:false,expired:false},{deleted:true,expired:false},{deleted:false,expired:true},{deleted:true,expired:true}])(
  "restarts after a Google change before predecessor dispatch without overwriting it: %j", async ({deleted,expired}) => {
    await withIsolatedLocalDatabase(async db => {
      const {first,week,windows,draft,publication,predecessor} = await replacement(db);
      const mappings = (await db.query("select * from public.team_workweek_google_series where publication_id=$1",[first.id])).rows;
      const baseline = predecessor.expectedPayload!;
      const external = deleted ? null : {...baseline,
        start:{...baseline.start,dateTime:new Date(Date.parse(baseline.start.dateTime)+3600000).toISOString()},
        end:{...baseline.end,dateTime:new Date(Date.parse(baseline.end.dateTime)+3600000).toISOString()},
        etag:"external-etag"};
      const provisional = new Map<string,unknown>();
      const writes: string[] = [];
      const provider: typeof fetch = async (input,init) => {
        const url = new URL(String(input));
        const id = url.pathname.split("/").at(-1)!;
        if (init?.method === "POST") {
          const payload = JSON.parse(String(init.body)); writes.push(payload.id);
          const event = {...payload,etag:"new-etag"}; provisional.set(payload.id,event); return Response.json(event);
        }
        if (init?.method === "DELETE") { writes.push(id); provisional.delete(id); return new Response(null,{status:204}); }
        if (init?.method === "PUT") { writes.push(id); throw new Error("The external predecessor must not be restored"); }
        const event = id===predecessor.googleEventId ? external : provisional.get(id);
        return event ? Response.json(event) : new Response(null,{status:404});
      };
      const claim = (await service(db,()=>db.query("select public.claim_team_workweek_provider_operation($1,1,'publish') as value",[publication.id]))).rows[0].value;
      for (const effect of publication.effects.filter((effect: PreparedWorkweekEffect)=>effect.operation==="create")) {
        const result = await ensureGoogleWorkweekEffect({accessToken:"test",effect,fetchImpl:provider,writeJournal:record(db,claim.id,effect.id)});
        expect(result.state).toBe("confirmed");
        if (result.state==="confirmed") await service(db,()=>db.query("select public.confirm_team_workweek_effect($1,1,$2,$3)",[effect.id,result.etag,effect.payload]));
      }
      expect(await ensureGoogleWorkweekEffect({accessToken:"test",effect:predecessor,fetchImpl:provider,writeJournal:record(db,claim.id,predecessor.id)})).toMatchObject({state:"delayed",errorClass:"provider_identity_mismatch"});
      await service(db,()=>db.query("select public.finish_team_workweek_provider_operation($1)",[claim.id]));
      await service(db,()=>db.query("select public.delay_team_workweek_publication($1,'provider_identity_mismatch')",[publication.id]));
      expect((await db.query("select last_error_class from public.team_workweek_publications where id=$1",[publication.id])).rows[0].last_error_class).toBe("provider_identity_mismatch");
      if (expired) await db.query("update public.team_workweek_publications set effective_at=clock_timestamp()-interval '1 minute' where id=$1",[publication.id]);
      expect((await service(db,()=>db.query("select public.request_team_workweek_publication_restart($1,$2) as value",[publication.id,owner]))).rows[0].value.state).toBe("ready");
      const cleanup = (await service(db,()=>db.query("select public.claim_team_workweek_provider_operation($1,1,'cleanup') as value",[publication.id]))).rows[0].value;
      let skipped = false;
      for (let stage=0;stage<3;stage++) {
        const plan = (await service(db,()=>db.query("select public.prepare_team_workweek_effect_cleanup($1,1) as value",[publication.id]))).rows[0].value;
        for (const effect of plan.effects as PreparedWorkweekEffect[]) {
          if (effect.state==="cleaned") { if (effect.id===predecessor.id) skipped=true; continue; }
          const result = await cleanupGoogleWorkweekEffect({accessToken:"test",effect,fetchImpl:provider,writeJournal:record(db,cleanup.id,effect.id)});
          expect(result.state).toBe("confirmed");
          if (result.state==="confirmed") await service(db,()=>db.query("select public.confirm_team_workweek_planned_cleanup($1,1,$2,false)",[effect.id,result.etag]));
        }
      }
      expect(skipped).toBe(true);
      expect(writes).not.toContain(predecessor.googleEventId);
      expect(provisional.size).toBe(0);
      expect((await db.query("select state,cleanup_skipped,cleanup_confirmed_etag,observed_at from public.team_workweek_publication_effects where id=$1",[predecessor.id])).rows[0]).toEqual({state:"cleaned",cleanup_skipped:true,cleanup_confirmed_etag:null,observed_at:null});
      expect((await db.query("select * from public.team_workweek_google_series where publication_id=$1",[first.id])).rows).toEqual(mappings);
      expect(await captureDatabaseError(db,()=>service(db,()=>db.query("select public.record_team_workweek_provider_write($1,$2,'dispatched')",[cleanup.id,predecessor.id])))).toMatchObject({code:"P0003"});
      expect(await captureDatabaseError(db,()=>service(db,()=>db.query("select public.confirm_team_workweek_planned_cleanup($1,1,'invented-etag',false)",[predecessor.id])))).toMatchObject({code:"P0003"});
      await service(db,()=>db.query("select public.finish_team_workweek_provider_operation($1)",[cleanup.id]));
      const fresh = (await asAuthenticated(db,user,()=>db.query("select public.restart_private_team_workweek_version($1) as value",[draft.id]))).rows[0].value;
      expect((await db.query("select selected_week_start::text,base_publication_id from public.team_workweek_versions where id=$1",[fresh.versionId])).rows[0]).toEqual({selected_week_start:week,base_publication_id:first.id});
      expect((await db.query("select weekday,start_minute,end_minute from public.team_workweek_windows where version_id=$1",[fresh.versionId])).rows).toEqual(windows.map(w=>({weekday:w.weekday,start_minute:w.startMinute,end_minute:w.endMinute})));
      // The unchanged stored baseline lets the next preflight capture the external change.
      const observation = [{seriesId:mappings[0].id,priorEtag:"first-etag",observedEtag:deleted?null:"external-etag",founderopsRevision:1,providerState:deleted?"deleted":"active",...(!deleted?{observedPayload:external}:{})}];
      const conflict = deleted
        ? (await service(db,()=>db.query("select public.capture_team_workweek_physical_conflict($1,$2,1,'[]',$3,$4,false,true,clock_timestamp()) as value",[owner,first.id,JSON.stringify(observation),"a".repeat(64)]))).rows[0].value
        : (await service(db,()=>db.query("select public.create_team_workweek_google_conflict($1,$2,1,$3,$4,$5,$6,$7,$8) as value",[owner,first.id,fresh.versionId,week,JSON.stringify([{weekday:1,startMinute:600,endMinute:1020}]),JSON.stringify(observation),"a".repeat(64),"b".repeat(64)]))).rows[0].value;
      expect((await db.query("select base_publication_id,state from public.team_workweek_google_conflicts where id=$1",[conflict.id])).rows[0]).toEqual({base_publication_id:first.id,state:"open"});
      expect((await db.query("select status from public.team_workweek_publications where id=$1",[publication.id])).rows[0].status).toBe("inactive");
    });
  },30_000);

it.each(["dispatched","uncertain","settled","confirmed"])("does not skip predecessor evidence already %s",async state=>{
  await withIsolatedLocalDatabase(async db=>{
    const {publication,predecessor}=await replacement(db);
    if(state==="confirmed") await service(db,()=>db.query("select public.confirm_team_workweek_effect($1,1,'confirmed-etag',$2)",[predecessor.id,predecessor.payload]));
    else {
      const claim=(await service(db,()=>db.query("select public.claim_team_workweek_provider_operation($1,1,'publish') as value",[publication.id]))).rows[0].value;
      await service(db,()=>db.query("select public.record_team_workweek_provider_write($1,$2,'dispatched')",[claim.id,predecessor.id]));
      if(state!=="dispatched") await service(db,()=>db.query("select public.record_team_workweek_provider_write($1,$2,$3)",[claim.id,predecessor.id,state]));
      await service(db,()=>db.query("select public.finish_team_workweek_provider_operation($1)",[claim.id]));
    }
    await service(db,()=>db.query("select public.request_team_workweek_publication_restart($1,$2)",[publication.id,owner]));
    if(state==="dispatched"||state==="uncertain") expect(await captureDatabaseError(db,()=>service(db,()=>db.query("select public.prepare_team_workweek_effect_cleanup($1,1)",[publication.id])))).toMatchObject({code:"P0003"});
    else await service(db,()=>db.query("select public.prepare_team_workweek_effect_cleanup($1,1)",[publication.id]));
    expect((await db.query("select state,cleanup_skipped from public.team_workweek_publication_effects where id=$1",[predecessor.id])).rows[0]).toEqual({state:state==="confirmed"?"confirmed":"pending",cleanup_skipped:false});
  });
},30_000);
