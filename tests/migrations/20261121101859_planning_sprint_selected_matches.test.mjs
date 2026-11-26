import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves the old Sprint read and requires an authorized service session for the projection", { timeout: 120_000 }, async () => {
  await resetLocalDatabaseTo("20261120222556");
  await withLocalDatabase(async db => {
    const user = randomUUID(), session = randomUUID();
    await db.query("insert into auth.users(id,email,role,aud) values($1,'sprint-projection-upgrade@example.test','authenticated','authenticated')", [user]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [session, user]);
    await db.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Sprint projection upgrade')");
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('sprint-projection-viewer',$1,'Sprint viewer','viewer')", [user]);
    await db.query("insert into public.sprints(id,project_id,name,start_date,end_date) values('sprint-projection-test','findmydoc-founder-execution','Sprint projection test','2000-01-01','2099-12-31')");
    const evaluation = (await db.query("select statement_timestamp()::text as observed")).rows[0].observed;
    const deadline = (await db.query("select (statement_timestamp()+interval '1 hour')::text as deadline")).rows[0].deadline;
    const publication = async () => (await db.query("select public.planning_sprint_task_scope('sprint-projection-viewer',$1,$2,'viewer',$3,'selected','sprint-projection-test','{}',0,null,$4) as result", [user, session, deadline, evaluation])).rows[0].result;
    const before = await publication();
    expect(before).toMatchObject({ status: "ready", sprint_id: "sprint-projection-test", page_ids: [], scope_total: 0, matched_total: 0 });
    await applyMigration(db, resolve("supabase/migrations/20261121101859_planning_sprint_selected_matches.sql"));
    expect(await publication()).toEqual(before);
    const signature = "public.planning_sprint_selected_matches(text,uuid,uuid,text,timestamptz,text,jsonb,text,timestamptz)";
    const projection = async (actor = user, expiry = deadline, source = before.source_revision, role = "viewer") => (await db.query("select public.planning_sprint_selected_matches('sprint-projection-viewer',$1,$2,$3,$4,'sprint-projection-test','{}',$5,$6) as result", [actor, session, role, expiry, source, evaluation])).rows[0].result;
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, signature])).rows[0].allowed).toBe(role === "service_role");
      await db.query(`set role ${role}`);
      try {
        if (role !== "service_role") await expect(projection()).rejects.toMatchObject({ code: "42501" });
        else {
          expect(await projection()).toEqual({ status: "ready", sprint_id: before.sprint_id, source_revision: before.source_revision,
            evaluated_at: before.evaluated_at, valid_until: before.valid_until, scope_total: 0, matched_total: 0, page_ids: [] });
          expect(await projection(randomUUID())).toEqual({ status: "forbidden" });
          expect(await projection(user, deadline, before.source_revision, "ceo")).toEqual({ status: "forbidden" });
          expect(await projection(user, "2000-01-01T00:00:00Z")).toEqual({ status: "forbidden" });
          expect(await projection(user, deadline, "old-source")).toEqual({ status: "staleContinuation" });
        }
      } finally { await db.query("reset role"); }
    }
    await db.query("delete from auth.sessions where id=$1", [session]);
    expect(await projection()).toEqual({ status: "forbidden" });
  });
});
