import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves existing detail records and isolates discussion revisions behind fixed publication privileges", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261115115327");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic detail migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('detail-migration','Synthetic founder','founder')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,owner) values('detail-migration','findmydoc-founder-execution','Existing detail','epic','Offen','detail-migration')");
    await client.query("insert into public.task_comments(task_id,profile_id,comment) values('detail-migration','detail-migration','Existing discussion')");
    const records = async () => ({
      tasks: (await client.query("select * from public.tasks order by id")).rows,
      profiles: (await client.query("select * from public.profiles order by id")).rows,
      comments: (await client.query("select * from public.task_comments order by id")).rows,
    });
    const before = await records();
    await applyMigration(client, resolve("supabase/migrations/20261115190023_planning_detail_area_sources.sql"));
    expect(await records()).toEqual(before);
    const revision = async area => (await client.query("select public.planning_detail_source('detail-migration',$1) as value", [area])).rows[0].value.source_revision;
    const targetBefore = await revision("target"), discussionBefore = await revision("discussion");
    await client.query("update public.task_comments set comment='Changed discussion only' where task_id='detail-migration'");
    expect(await revision("target")).toBe(targetBefore);
    expect(await revision("discussion")).not.toBe(discussionBefore);
    expect((await records()).tasks).toEqual(before.tasks);
    expect((await client.query("select relrowsecurity as enabled from pg_class where oid='workspace_private.planning_detail_area_revision'::regclass")).rows[0].enabled).toBe(true);
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await client.query("select has_function_privilege($1,'public.planning_detail_source(text,text)','EXECUTE') as allowed", [role])).rows[0].allowed).toBe(role === "service_role");
      expect((await client.query("select has_function_privilege($1,'public.planning_detail_publication_context(text,text)','EXECUTE') as allowed", [role])).rows[0].allowed).toBe(role === "authenticated");
      await client.query(`set role ${role}`);
      try {
        await expect(client.query("select * from workspace_private.planning_detail_area_revision")).rejects.toMatchObject({ code: "42501" });
        if (role !== "service_role") await expect(client.query("select public.planning_detail_source('detail-migration','target')")).rejects.toMatchObject({ code: "42501" });
        else expect((await client.query("select public.planning_detail_source('detail-migration','target') as value")).rows[0].value.source_revision).toBe(targetBefore);
      } finally { await client.query("reset role"); }
    }
  });
});
