import { expect, it } from "vitest";
import { asAuthenticated, captureDatabaseError, withIsolatedLocalDatabase } from "./helpers/local-database";

it("replaces a confirmed future week while preserving the later plan and refusing stale edits", async () => {
  await withIsolatedLocalDatabase(async (db) => {
    const user = "58000000-0000-4000-8000-000000000099";
    await db.query("insert into auth.users(id) values($1)", [user]);
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('selected-week-owner',$1,'Owner','viewer')", [user]);
    const sources = (await db.query(`insert into public.team_workweek_versions(owner_profile_id,effective_from)
      select 'selected-week-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+offset_days from unnest(array[7,14]) offset_days returning id,effective_from::text`)).rows;
    const later = (await db.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,publication_revision,published_at,last_sync_at)
      values($1,'selected-week-owner',$2,'[]','published','confirmed',2,clock_timestamp(),clock_timestamp()) returning *`, [sources[1].id, sources[1].effective_from])).rows[0];
    const target = (await db.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,effective_to,windows,status,sync_state,publication_revision,published_at,last_sync_at,superseded_by_publication_id)
      values($1,'selected-week-owner',$2,$3::date-1,'[{"weekday":1,"startMinute":540,"endMinute":960}]','published','confirmed',1,clock_timestamp(),clock_timestamp(),$4) returning *`, [sources[0].id, sources[0].effective_from, sources[1].effective_from, later.id])).rows[0];
    const window = (await db.query("insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values($1,1,540,960) returning id",[sources[0].id])).rows[0];
    await db.query(`insert into public.team_workweek_google_series(publication_id,source_window_id,owner_profile_id,google_event_id,state,confirmed_etag,confirmed_founderops_revision,last_confirmed_at)
      values($1,$2,'selected-week-owner','fopsselectedtarget','confirmed','old-etag',1,clock_timestamp())`,[target.id,window.id]);
    const context = (await asAuthenticated(db,user,()=>db.query("select public.team_workweek_edit_context($1) as context",[sources[0].effective_from]))).rows[0].context;
    expect(context.basePublicationId).toBe(target.id);
    expect(context.windows).toEqual([{weekday:1,startMinute:540,endMinute:960}]);
    expect(context.effectiveUntil).toBeTruthy();
    const save = async () => (await asAuthenticated(db,user,()=>db.query("select public.create_private_selected_team_workweek_version($1,'[]',$2) as version",[sources[0].effective_from,context.contextToken]))).rows[0].version;
    const draft = await save();
    const duplicate = await save();
    const prepared = (await asAuthenticated(db,user,()=>db.query("select public.prepare_team_workweek_publication($1,1) as publication",[draft.id]))).rows[0].publication;
    expect(prepared.predecessorPublicationId).toBe(target.id);
    expect(prepared.successorPublicationId).toBe(later.id);
    expect(new Date(prepared.effectiveUntil).getTime()).toBeGreaterThan(new Date(prepared.effectiveAt).getTime());
    expect(prepared.effects).toHaveLength(1);
    expect(prepared.effects[0]).toMatchObject({operation:"cancel",googleEventId:"fopsselectedtarget"});
    await db.query("set local role service_role");
    await db.query("select public.confirm_team_workweek_effect($1,1,'cancelled-etag',$2)",[prepared.effects[0].id,prepared.effects[0].payload]);
    await db.query("reset role");
    await asAuthenticated(db,user,()=>db.query("select public.finalize_team_workweek_publication($1)",[prepared.id]));
    expect((await db.query("select * from public.team_workweek_publications where id=$1",[later.id])).rows[0]).toEqual(later);
    const old = (await db.query("select effective_until,effective_to from public.team_workweek_publications where id=$1",[target.id])).rows[0];
    expect(old.effective_until.toISOString()).toBe(new Date(prepared.effectiveAt).toISOString());
    const stale = await captureDatabaseError(db,()=>asAuthenticated(db,user,()=>db.query("select public.prepare_team_workweek_publication($1,1)",[duplicate.id])));
    expect(stale).toMatchObject({code:"P0004"});
  });
});

it.each(["unchanged", "before preparation", "before finalization"])("inserts before a later plan and checks its pinned state: %s", async (stage) => {
  await withIsolatedLocalDatabase(async db => {
    const user="58000000-0000-4000-8000-000000000098";
    await db.query("insert into auth.users(id) values($1)",[user]);
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('insert-week-owner',$1,'Owner','founder')",[user]);
    const source=(await db.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('insert-week-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+14) returning id,effective_from::text")).rows[0];
    const later=(await db.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,publication_revision,published_at,last_sync_at)
      values($1,'insert-week-owner',$2,'[]','published','confirmed',1,clock_timestamp(),clock_timestamp()) returning *`,[source.id,source.effective_from])).rows[0];
    const week=(await db.query("select ($1::date-7)::text as week",[source.effective_from])).rows[0].week;
    const context=(await asAuthenticated(db,user,()=>db.query("select public.team_workweek_edit_context($1) as value",[week]))).rows[0].value;
    const draft=(await asAuthenticated(db,user,()=>db.query("select public.create_private_selected_team_workweek_version($1,'[]',$2) as value",[week,context.contextToken]))).rows[0].value;
    const prepared=stage==='before preparation'?null:(await asAuthenticated(db,user,()=>db.query("select public.prepare_team_workweek_publication($1,1) as value",[draft.id]))).rows[0].value;
    if(stage!=='unchanged') {
      await db.query("update public.team_workweek_publications set publication_revision=99 where id=$1",[later.id]);
      const failure=await captureDatabaseError(db,()=>asAuthenticated(db,user,()=>prepared
        ? db.query("select public.finalize_team_workweek_publication($1)",[prepared.id])
        : db.query("select public.prepare_team_workweek_publication($1,1)",[draft.id])));
      expect(failure).toMatchObject({code:'P0004'});
    } else {
      expect(prepared.predecessorPublicationId).toBeNull();
      expect(prepared.successorPublicationId).toBe(later.id);
      await asAuthenticated(db,user,()=>db.query("select public.finalize_team_workweek_publication($1)",[prepared.id]));
      expect((await db.query("select * from public.team_workweek_publications where id=$1",[later.id])).rows[0]).toEqual(later);
    }
  });
});

it("keeps a selected future plan blocked while a dispatched Google write has an uncertain late outcome", async () => {
  await withIsolatedLocalDatabase(async db => {
    const user='58000000-0000-4000-8000-000000000097';
    await db.query("insert into auth.users(id) values($1)",[user]);
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('late-week-owner',$1,'Owner','deputy')",[user]);
    const week=(await db.query("select (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7)::text as week")).rows[0].week;
    const context=(await asAuthenticated(db,user,()=>db.query("select public.team_workweek_edit_context($1) as value",[week]))).rows[0].value;
    const draft=(await asAuthenticated(db,user,()=>db.query(`select public.create_private_selected_team_workweek_version($1,'[{"weekday":1,"startMinute":540,"endMinute":960}]',$2) as value`,[week,context.contextToken]))).rows[0].value;
    const pub=(await asAuthenticated(db,user,()=>db.query("select public.prepare_team_workweek_publication($1,1) as value",[draft.id]))).rows[0].value;
    const effect=pub.effects.find((entry:{operation:string})=>entry.operation==='create');
    expect(effect).toBeTruthy();
    await db.query("select set_config('request.jwt.claim.role','service_role',true)");
    await db.query("set local role service_role");
    const operation=(await db.query("select public.claim_team_workweek_provider_operation($1,1,'publish') as value",[pub.id])).rows[0].value;
    await db.query("select public.record_team_workweek_provider_write($1,$2,'dispatched')",[operation.id,effect.id]);
    expect((await db.query("select public.request_team_workweek_publication_restart($1,'late-week-owner') as value",[pub.id])).rows[0].value).toMatchObject({state:'delayed',reason:'in_progress'});
    await db.query("select public.finish_team_workweek_provider_operation($1)",[operation.id]);
    expect((await db.query("select public.request_team_workweek_publication_restart($1,'late-week-owner') as value",[pub.id])).rows[0].value).toMatchObject({state:'delayed',reason:'uncertain'});
    const late=await captureDatabaseError(db,()=>db.query("select public.confirm_team_workweek_effect($1,1,'late-etag',$2)",[effect.id,effect.payload]));
    expect(late).toMatchObject({code:'P0003'});
    await db.query('reset role');
    const finalize=await captureDatabaseError(db,()=>asAuthenticated(db,user,()=>db.query("select public.finalize_team_workweek_publication($1)",[pub.id])));
    expect(finalize).toMatchObject({code:'P0003'});
    expect((await db.query("select count(*)::integer as count from public.team_workweek_publications where owner_profile_id='late-week-owner' and status='published'")).rows[0].count).toBe(0);
  });
});

it.each(['ceo','founder','deputy','viewer'])("allows only the mapped owner's selected week for %s",async role=>{
  await withIsolatedLocalDatabase(async db=>{
    const user='58000000-0000-4000-8000-000000000096';
    await db.query("insert into auth.users(id) values($1)",[user]);
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('week-role-owner',$1,'Owner',$2)",[user,role]);
    const week=(await db.query("select date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date::text as week")).rows[0].week;
    const context=(await asAuthenticated(db,user,()=>db.query("select public.team_workweek_edit_context($1) as value",[week]))).rows[0].value;
    const version=(await asAuthenticated(db,user,()=>db.query("select public.create_private_selected_team_workweek_version($1,'[]',$2) as value",[week,context.contextToken]))).rows[0].value;
    expect(version).toMatchObject({effectiveFrom:week,activationMode:'immediate'});
    expect((await db.query("select owner_profile_id from public.team_workweek_versions where id=$1",[version.id])).rows[0].owner_profile_id).toBe('week-role-owner');
    const unmapped='58000000-0000-4000-8000-000000000095';
    await db.query("insert into auth.users(id) values($1)",[unmapped]);
    const denied=await captureDatabaseError(db,()=>asAuthenticated(db,unmapped,()=>db.query("select public.team_workweek_edit_context($1)",[week])));
    expect(denied).toMatchObject({code:'42501'});
  });
});

it("requires a new week selection when a saved current-week draft has aged into the past",async()=>{
  await withIsolatedLocalDatabase(async db=>{
    const user='58000000-0000-4000-8000-000000000094';
    await db.query("insert into auth.users(id) values($1)",[user]);
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('aged-week-owner',$1,'Owner','founder')",[user]);
    const week=(await db.query("select date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date::text as week")).rows[0].week;
    const context=(await asAuthenticated(db,user,()=>db.query("select public.team_workweek_edit_context($1) as value",[week]))).rows[0].value;
    const version=(await asAuthenticated(db,user,()=>db.query("select public.create_private_selected_team_workweek_version($1,'[]',$2) as value",[week,context.contextToken]))).rows[0].value;
    // Age the persisted fixture instead of waiting a real week.
    await db.query("update public.team_workweek_versions set effective_from=effective_from-7,selected_week_start=selected_week_start-7 where id=$1",[version.id]);
    const denied=await captureDatabaseError(db,()=>asAuthenticated(db,user,()=>db.query("select public.prepare_team_workweek_publication($1,1)",[version.id])));
    expect(denied).toMatchObject({code:'P0004'});
    expect((await db.query("select count(*)::integer as count from public.team_workweek_publication_effects where owner_profile_id='aged-week-owner'")).rows[0].count).toBe(0);
  });
});
