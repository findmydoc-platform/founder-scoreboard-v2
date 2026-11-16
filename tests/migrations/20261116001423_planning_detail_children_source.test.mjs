import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves version 54 records and target semantics while admitting children behind unchanged source privileges", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261115213239");
  await withLocalDatabase(async client => {
    const user = randomUUID(), session = randomUUID(), unmapped = randomUUID();
    await client.query("insert into auth.users(id,email,role,aud,email_confirmed_at) values($1,'synthetic-children-migration@example.test','authenticated','authenticated',now())", [user]);
    await client.query("insert into auth.sessions(id,user_id,created_at) values($1,$2,now())", [session, user]);
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic child migration')");
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('children-migration',$1,'Synthetic founder','founder')", [user]);
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner) values('children-epic','findmydoc-founder-execution','Existing Epic','epic','Offen','P2','children-migration')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,parent_task_id,approval_status) values('children-initiative','findmydoc-founder-execution','Existing Initiative','initiative','Offen','P2','children-migration','children-epic','approved')");
    await client.query("insert into public.tasks(id,project_id,title,description,task_type,status,priority,owner,parent_task_id,approval_status) values('children-target','findmydoc-founder-execution','Existing target','Preserved target content','deliverable','Offen','P2','children-migration','children-initiative','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,parent_task_id) values('children-direct','findmydoc-founder-execution','Existing direct child','sub_issue','Offen','P2','children-migration','children-target')");
    await client.query("insert into public.task_comments(task_id,profile_id,comment) values('children-target','children-migration','Preserved discussion')");
    const records = async () => ({
      tasks: (await client.query("select * from public.tasks order by id")).rows,
      profiles: (await client.query("select * from public.profiles order by id")).rows,
      comments: (await client.query("select * from public.task_comments order by id")).rows,
      users: (await client.query("select * from auth.users order by id")).rows,
      sessions: (await client.query("select * from auth.sessions order by id")).rows,
    });
    const source = async area => (await client.query("select public.planning_detail_source('children-target',$1) as value", [area])).rows[0].value;
    const before = await records(), targetBefore = await source("target");
    expect(before.tasks).toHaveLength(4); expect(before.comments).toHaveLength(1);
    await applyMigration(client, resolve("supabase/migrations/20261116001423_planning_detail_children_source.sql"));
    expect(await records()).toEqual(before);
    const targetAfter = await source("target");
    for (const key of ["target_id", "ancestor_ids", "source_revision", "valid_until"]) expect(targetAfter[key]).toEqual(targetBefore[key]);
    expect(targetAfter).toMatchObject({ target_id: "children-target", ancestor_ids: ["children-epic", "children-initiative"] });
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await client.query("select has_function_privilege($1,'public.planning_detail_source(text,text)','EXECUTE') allowed", [role])).rows[0].allowed).toBe(role === "service_role");
      expect((await client.query("select has_function_privilege($1,'public.planning_detail_publication_context(text,text)','EXECUTE') allowed", [role])).rows[0].allowed).toBe(role === "authenticated");
      await client.query(`set role ${role}`);
      try {
        if (role === "service_role") expect(await source("children")).toMatchObject({ target_id: "children-target", ancestor_ids: targetAfter.ancestor_ids, source_revision: targetAfter.source_revision });
        else await expect(source("children")).rejects.toMatchObject({ code: "42501" });
      } finally { await client.query("reset role"); }
    }
    await client.query("set role authenticated");
    try {
      const claims = async sub => client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub, role: "authenticated", session_id: session })]);
      await claims(user);
      const certificate = (await client.query("select public.planning_detail_publication_context('children-target','children') as value")).rows[0].value;
      expect(certificate).toMatchObject({ profile_id: "children-migration", platform_role: "founder", source_revision: targetAfter.source_revision });
      for (const key of ["target_id", "ancestor_ids", "descriptor"]) expect(certificate).not.toHaveProperty(key);
      await claims(unmapped);
      await expect(client.query("select public.planning_detail_publication_context('children-target','children')")).rejects.toMatchObject({ code: "42501" });
    } finally { await client.query("reset role"); }
  });
});
