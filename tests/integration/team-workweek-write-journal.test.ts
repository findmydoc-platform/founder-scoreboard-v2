import { asService } from "./helpers/workweek-provider";
import { expect, it } from "vitest";
import { asAuthenticated, captureDatabaseError, withIsolatedLocalDatabase } from "./helpers/local-database";

it.each(["ceo", "deputy", "founder", "viewer"])("binds dispatch and observed confirmation to an immutable journal for a %s owner", async role => {
  await withIsolatedLocalDatabase(async db => {
    const user="ca110000-0000-4000-8000-000000000001", unmapped="ca110000-0000-4000-8000-000000000002";
    await db.query("insert into auth.users(id) values($1),($2)",[user,unmapped]);
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('journal-owner',$1,'Owner',$2)",[user,role]);
    const draft=(await asAuthenticated(db,user,()=>db.query("select public.create_private_team_workweek_version('2099-01-12','[{\"weekday\":1,\"startMinute\":600,\"endMinute\":660}]') as value"))).rows[0].value;
    const plan=(await asAuthenticated(db,user,()=>db.query("select public.prepare_team_workweek_publication($1,1) as value",[draft.id]))).rows[0].value;
    expect(plan.writeJournalVersion).toBe(1);
    const effect=plan.effects[0];
    const claim=(await asService(db,()=>db.query("select public.claim_team_workweek_provider_operation($1,1,'publish') as value",[plan.id]))).rows[0].value;
    const dispatch=(owner="journal-owner",event=effect.googleEventId)=>db.query("select public.dispatch_google_calendar_mutation($1,'publication',$2,$3,$4,'POST',false)",[owner,claim.id,effect.id,event]);
    for(const actor of [user,unmapped]) {
      expect(await captureDatabaseError(db,()=>asAuthenticated(db,actor,()=>dispatch()))).toMatchObject({code:"42501"});
    }
    expect(await captureDatabaseError(db,()=>asService(db,()=>dispatch("foreign-owner")))).toMatchObject({code:"42501"});
    expect(await captureDatabaseError(db,()=>asService(db,()=>dispatch("journal-owner","foreign-event")))).toMatchObject({code:"42501"});
    expect(await captureDatabaseError(db,()=>asService(db,()=>db.query("select public.confirm_team_workweek_effect($1,1,'etag',$2)",[effect.id,effect.payload])))).toMatchObject({code:"P0003"});
    await asService(db,()=>dispatch());
    expect((await db.query("select state,evidence_kind from public.team_workweek_provider_writes where effect_id=$1",[effect.id])).rows).toEqual([{state:"dispatched",evidence_kind:"dispatch"}]);
    await asService(db,()=>db.query("select public.record_team_workweek_provider_write($1,$2,'observed')",[claim.id,effect.id]));
    await asService(db,()=>db.query("select public.confirm_team_workweek_effect($1,1,'observed-etag',$2)",[effect.id,effect.payload]));
    expect((await asAuthenticated(db,user,()=>db.query("select public.finalize_team_workweek_publication($1) as value",[plan.id]))).rows[0].value.status).toBe("published");
  });
},30000);
