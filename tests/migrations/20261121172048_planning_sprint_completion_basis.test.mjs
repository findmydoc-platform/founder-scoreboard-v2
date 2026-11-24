import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

test("a Completion upgrade preserves legacy locks and secures its new read and transactional operations", { timeout:120_000 }, async () => {
  await resetLocalDatabaseTo("20261121164406");
  await withLocalDatabase(async db => {
    const user = randomUUID(), session = randomUUID();
    await db.query("insert into auth.users(id,email,role,aud) values($1,'completion-upgrade@example.test','authenticated','authenticated')",[user]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)",[session,user]);
    await db.query("insert into public.projects(id,name,review_objection_window_hours) values('completion-other-project','Unchanged legacy project',48)");
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('completion-upgrade-ceo',$1,'CEO','ceo')",[user]);
    await db.query(`insert into public.sprints(id,project_id,name,start_date,end_date,status) values
      ('completion-legacy','completion-other-project','Legacy completion','2000-01-01','2000-01-14','review'),
      ('completion-new','completion-other-project','New completion','2000-02-01','2000-02-14','review')`);
    const guarded = "public.commit_sprint_completion_basis(text,timestamptz,jsonb,text[],jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,text,uuid,uuid,timestamptz,timestamptz,text)";
    const old = "public.lock_sprint_with_review_window_transaction(text,timestamptz,jsonb,text[],jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,text)";
    const definition = async () => (await db.query("select pg_get_functiondef($1::regprocedure) as value",[old])).rows[0].value;
    const original = await definition();
    await applyMigration(db,resolve("supabase/migrations/20261121172048_planning_sprint_completion_basis.sql"));
    expect(await definition()).toBe(original);

    for (const [signature, expected] of [
      [guarded,"service_role"],
      ["public.planning_sprint_completion_snapshot(text,text,uuid,uuid,timestamptz)","service_role"],
      ["public.planning_sprint_completion_publication_context(text)","authenticated"],
      ["workspace_private.advance_external_sprint_completion_revision()",null],
    ]) {
      for (const role of ["anon","authenticated","service_role"]) {
        expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') as value",[role,signature])).rows[0].value).toBe(role===expected);
      }
    }

    const snapshot = async sprint => (await db.query("select public.planning_sprint_completion_snapshot($1,'completion-upgrade-ceo',$2,$3,now()+interval '30 minutes') as read",
      [sprint,user,session])).rows[0].read;
    const ready = await snapshot("completion-new");
    expect(ready).toMatchObject({status:"ready",open_objections:0,tasks:[],sprint:{id:"completion-new",score_locked:false}});
    await db.query("update public.projects set review_objection_window_hours=72 where id='completion-other-project'");
    const changed = await snapshot("completion-new");
    expect(changed.source_revision).not.toBe(ready.source_revision);
    expect(Date.parse(changed.review_due_at) - Date.parse(ready.review_due_at)).toBe(24*60*60*1000);
    const commit = async source => (await db.query(`select public.commit_sprint_completion_basis(
      'completion-new',$1,'[]','{}','[]','[]','[]','[]','[]','{"_planning_lock_basis":[]}','completion-upgrade-ceo',null,null,
      $2,$3,now()+interval '30 minutes',$4,$5) result`,[changed.sprint.updated_at,user,session,changed.valid_until,source])).rows[0].result;
    await expect(commit(ready.source_revision)).rejects.toMatchObject({ code:"P0021" });
    const first = await commit(changed.source_revision);
    expect(first).toMatchObject({sprint:{id:"completion-new",status:"closed",scoreLocked:true}});
    expect(await commit(ready.source_revision)).toMatchObject({sprint:first.sprint,replayed:true});

    const legacy = (await db.query(`select public.lock_sprint_with_review_window_transaction('completion-legacy',
      (select updated_at from public.sprints where id='completion-legacy'),'[]','{}','[]','[]','[]','[]','[]',
      '{"_planning_lock_basis":[]}', 'completion-upgrade-ceo',null,null) as stored`)).rows[0].stored;
    expect(legacy).toMatchObject({sprint:{id:"completion-legacy",status:"closed",scoreLocked:true}});
  });
});
