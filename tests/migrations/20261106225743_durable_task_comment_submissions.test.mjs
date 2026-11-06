import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

const migration = resolve("supabase/migrations/20261106225743_durable_task_comment_submissions.sql");

it.sequential("adds service-only submission receipts without changing existing comments", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261104155306");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('comment-migration','Synthetic comment migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('comment-migration','Synthetic commenter','founder')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner) values('comment-migration','comment-migration','Existing comment target','epic','Offen','P2','comment-migration')");
    await client.query("select public.create_task_comment_with_notifications('comment-migration','comment-migration','Existing discussion',false)");
    const comments = async () => (await client.query("select * from public.task_comments where task_id='comment-migration'")).rows;
    const before = await comments();
    await applyMigration(client, migration);
    expect(await comments()).toEqual(before);
    expect((await client.query("select relrowsecurity as enabled from pg_class where oid='public.task_comment_submissions'::regclass")).rows[0].enabled).toBe(true);
    const signature = "public.create_task_comment_submission(uuid,timestamptz,text,text,text,boolean,text[],text[])";
    for (const role of ["anon", "authenticated", "service_role"]) {
      const expected = role === "service_role";
      expect((await client.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, signature])).rows[0].allowed).toBe(expected);
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect((await client.query("select has_table_privilege($1,'public.task_comment_submissions',$2) as allowed", [role, privilege])).rows[0].allowed).toBe(expected);
      }
    }
    await applyMigration(client, migration);
    expect(await comments()).toEqual(before);
  });
});
