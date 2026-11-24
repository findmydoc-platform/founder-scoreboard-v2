import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("keeps existing Sprint reads compatible and exposes joint matching only with a bound service session", { timeout:120_000 }, async () => {
  await resetLocalDatabaseTo("20261121101859");
  await withLocalDatabase(async db => {
    const user = randomUUID(), session = randomUUID();
    await db.query("insert into auth.users(id,email,role,aud) values($1,'sprint-joint-upgrade@example.test','authenticated','authenticated')",[user]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)",[session,user]);
    await db.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Sprint joint upgrade')");
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('sprint-joint-ceo',$1,'Sprint CEO','ceo')",[user]);
    await db.query("insert into public.sprints(id,project_id,name,start_date,end_date) values('sprint-joint-test','findmydoc-founder-execution','Sprint joint test','2000-01-01','2099-12-31')");
    const {rows:[{ deadline, evaluation, source }]} = await db.query("select (statement_timestamp()+interval '1 hour')::text as deadline,statement_timestamp()::text as evaluation,public.planning_source_version() as source");
    const args = [user,session,deadline,source,evaluation];
    const matches = async () => (await db.query("select public.planning_sprint_selected_matches('sprint-joint-ceo',$1,$2,'ceo',$3,'sprint-joint-test','{}',$4,$5) result",args)).rows[0].result;
    const assignment = async () => (await db.query("select public.planning_sprint_task_scope('sprint-joint-ceo',$1,$2,'ceo',$3,'assignment','sprint-joint-test','{}',0,$4,$5) result",args)).rows[0].result;
    const original = { assignment:await assignment(), selected:await matches() };
    await applyMigration(db,resolve("supabase/migrations/20261121135639_planning_sprint_assignment_and_selected_matches.sql"));
    expect({ assignment:await assignment(), selected:await matches() }).toEqual(original);
    const signature = "public.planning_sprint_assignment_and_selected_matches(text,uuid,uuid,text,timestamptz,text,jsonb,text,timestamptz,timestamptz,timestamptz)";
    const joined = async (role = "ceo", expectedSource = source, originalDeadline = deadline) => (await db.query(`select public.planning_sprint_assignment_and_selected_matches('sprint-joint-ceo',$1,$2,$3,$4,'sprint-joint-test','{}',$5,$6,$7,$8) result`,[user,session,role,deadline,expectedSource,evaluation,original.selected.valid_until,originalDeadline])).rows[0].result;
    for (const role of ["anon","authenticated","service_role"]) {
      expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed).toBe(role==="service_role");
      await db.query(`set role ${role}`);
      try {
        if (role !== "service_role") await expect(joined()).rejects.toMatchObject({code:"42501"});
        else {
          expect(await joined()).toEqual(original);
          for (const expired of [await joined("ceo","obsolete"),await joined("ceo",source,"2000-01-01")]) {
            expect(expired.assignment).toMatchObject({status:"ready",scope_total:0,page_ids:[]});
            expect(expired.selected).toEqual({status:"staleContinuation"});
          }
          expect((await joined("viewer")).assignment).toEqual({status:"forbidden"});
        }
      } finally { await db.query("reset role"); }
    }
    await db.query("delete from auth.sessions where id=$1", [session]);
    expect((await joined()).assignment).toEqual({status:"forbidden"});
  });
});
