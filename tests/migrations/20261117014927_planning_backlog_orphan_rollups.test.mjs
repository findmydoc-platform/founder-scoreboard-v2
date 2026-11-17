import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves version 65 records and reader ACL while adding independent complete orphan rollups", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261117013121");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic counts migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('counts-founder','Synthetic founder','founder')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,approval_status) values('counts-epic','findmydoc-founder-execution','Existing Epic','epic','Offen','P2','counts-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('counts-initiative','findmydoc-founder-execution','Existing Initiative','initiative','counts-epic','Offen','P2','counts-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('counts-deliverable','findmydoc-founder-execution','Existing Deliverable','deliverable','counts-initiative','Offen','P2','counts-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,approval_status) values('counts-orphan-initiative','findmydoc-founder-execution','Completed orphan Initiative','initiative','Erledigt','P2','counts-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,approval_status) values('counts-orphan-deliverable','findmydoc-founder-execution','Completed orphan Deliverable','deliverable','Erledigt','P2','counts-founder','proposed')");
    const records = async () => ({ projects: (await client.query("select * from public.projects order by id")).rows,
      profiles: (await client.query("select * from public.profiles order by id")).rows, tasks: (await client.query("select * from public.tasks order by id")).rows,
      sprints: (await client.query("select * from public.sprints order by id")).rows, commitments: (await client.query("select * from public.sprint_commitments order by id")).rows });
    const support = async area => (await client.query("select public.planning_backlog_support('counts-founder',$1,'2026-01-01') value", [area])).rows[0].value;
    const before = await records(), oldControls = await support("controls"), oldSprints = await support("sprints");
    const source = (await client.query("select updated_at::text as version,public.planning_source_version() as revision from public.tasks where id='counts-deliverable'")).rows[0];
    const rank = async () => (await client.query("select public.planning_backlog_rank_target('counts-founder','counts-deliverable',$1,$2,'top') value", [source.version, source.revision])).rows[0].value;
    const oldRank = await rank();
    await applyMigration(client, resolve("supabase/migrations/20261117014927_planning_backlog_orphan_rollups.sql"));
    expect(await records()).toEqual(before);
    const current = await support("controls"), currentSprints = await support("sprints"), currentRank = await rank();
    for (const field of ["status", "source_revision", "valid_until"]) { expect(current[field]).toEqual(oldControls[field]); expect(currentSprints[field]).toEqual(oldSprints[field]); expect(currentRank[field]).toEqual(oldRank[field]); }
    expect(current.controls).toMatchObject(oldControls.controls);
    expect(current.controls.scopeCounts).toEqual({ all: 1, proposals: 0, ready: 1, unscheduled: 1 });
    expect(current.controls.orphanProgress).toEqual({orphanInitiatives:{total:1,completed:1,unfinished:0},orphanDeliverables:{total:1,completed:1,unfinished:0}});
    expect(currentSprints.buckets).toEqual(oldSprints.buckets); expect(currentRank.target_id).toBe(oldRank.target_id); expect(currentRank.noop).toBe(oldRank.noop);
    const signature = "public.planning_backlog_support(text,text,date,timestamptz,timestamptz)";
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).rows[0].allowed).toBe(role === "service_role");
      await client.query(`set role ${role}`);
      try {
        if (role !== "service_role") await expect(support("controls")).rejects.toMatchObject({ code: "42501" });
        else expect((await client.query("select public.planning_backlog_support('counts-unmapped','controls','2026-01-01') value")).rows[0].value).toEqual({ status: "forbidden" });
      } finally { await client.query("reset role"); }
    }
  });
});
