import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

test("assessment reuses the support clock and preserves existing Sprint selection", { timeout: 120_000 }, async () => {
  await resetLocalDatabaseTo("20261121162626");
  await withLocalDatabase(async db => {
    const user = randomUUID(), session = randomUUID();
    await db.query("insert into auth.users(id,email,role,aud) values($1,'assessment-migration@example.test','authenticated','authenticated')", [user]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [session,user]);
    await db.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Scoped assessment')");
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('assessment-ceo',$1,'CEO','ceo')", [user]);
    await db.query("insert into public.sprints(id,project_id,name,start_date,end_date) values('assessment','findmydoc-founder-execution','Assessment','2000-01-01','2099-12-31')");
    const { rows:[{ source, evaluation, deadline }] } = await db.query("select public.planning_source_version() as source,statement_timestamp()::text as evaluation,(statement_timestamp()+interval '1 hour')::text as deadline");
    const args = ["assessment", "assessment-ceo",user,session,"ceo",deadline];
    const selected = async (bound = source) => (await db.query("select public.planning_sprint_task_scope($1,$2,$3,$4,$5,'selected',$6,'{}',0,$7,$8) result",
      ["assessment-ceo",user,session,"ceo",deadline,"assessment",bound,evaluation])).rows[0].result;
    const before = await selected();
    await applyMigration(db, resolve("supabase/migrations/20261121164406_planning_sprint_assessment.sql"));
    expect(await selected()).toEqual(before);

    const snapshot = async (parameters = args) => (await db.query("select public.planning_sprint_assessment_snapshot($1,$2,$3,$4,$5,$6) result",parameters)).rows[0].result;
    const empty = await snapshot();
    expect(empty).toMatchObject({ status:"ready", sprint_id:"assessment", meetings:[], attendance:[] });
    await db.query("insert into public.meetings(sprint_id,title,meeting_at) values('assessment','Required attendance',now())");
    const withMeeting = await snapshot();
    expect(withMeeting.meetings).toHaveLength(1);
    expect(withMeeting.source_revision).not.toBe(empty.source_revision);
    expect(await selected()).toEqual({ status:"staleContinuation" });
    expect((await selected(null)).source_revision).toBe(withMeeting.source_revision);
    expect(await snapshot([...args.slice(0,-1),"2000-01-01"])).toEqual({ status:"forbidden" });
    await db.query("delete from auth.sessions where id=$1",[session]);
    expect(await snapshot()).toEqual({ status:"forbidden" });

    for (const [signature, permitted] of [
      ["public.planning_sprint_assessment_snapshot(text,text,uuid,uuid,text,timestamptz)","service_role"],
      ["public.planning_sprint_assessment_publication_context(text)","authenticated"],
    ]) {
      for (const role of ["anon","authenticated","service_role"]) {
        const { rows:[{ allowed }] } = await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,signature]);
        expect(allowed).toBe(role===permitted);
      }
    }
  });
});
