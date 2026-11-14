import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves existing Planning rows and exposes complete selected summaries only through the server role", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261113125756");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic summary migration')");
    for (const role of ["ceo", "deputy", "founder", "viewer"]) {
      await client.query("insert into public.profiles(id,name,platform_role) values($1,$2,$3)", [`summary-${role}`, `Synthetic ${role}`, role]);
    }
    await client.query(`insert into public.tasks(id,project_id,title,task_type,approval_status,status,priority)
      values('summary-parent','findmydoc-founder-execution','Synthetic preserved parent','deliverable','approved','Offen','P2')`);
    await client.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority)
      values('summary-child','findmydoc-founder-execution','Synthetic preserved child','sub_issue','summary-parent','Erledigt','P2')`);
    await client.query("insert into public.task_links(id,task_id,type,url) values('summary-link','summary-parent','evidence','https://example.test/preserved')");
    await client.query("insert into public.profile_ui_preferences(profile_id,planning_filters) values('summary-viewer','{\"query\":\"preserved\"}')");
    const preserved = {};
    for (const table of ["tasks", "profiles", "task_links", "profile_ui_preferences"]) {
      preserved[table] = (await client.query(`select * from public.${table} order by 1`)).rows;
    }
    const revision = (await client.query("select public.planning_source_version() as value")).rows[0].value;
    await applyMigration(client, resolve("supabase/migrations/20261114152512_planning_board_aggregates.sql"));
    for (const table of Object.keys(preserved)) expect((await client.query(`select * from public.${table} order by 1`)).rows).toEqual(preserved[table]);
    expect((await client.query("select public.planning_source_version() as value")).rows[0].value).toBe(revision);
    for (const role of ["anon", "authenticated"]) {
      await client.query(`set role ${role}`);
      try {
        for (const actor of ["summary-ceo", "summary-deputy", "summary-founder", "summary-viewer", "unmapped"]) {
          await expect(client.query("select public.planning_deliverable_summaries($1,array['summary-parent'], $2, now())", [actor, revision])).rejects.toMatchObject({ code: "42501" });
        }
      } finally { await client.query("reset role"); }
    }
    await client.query("set role service_role");
    try {
      for (const actor of ["summary-ceo", "summary-deputy", "summary-founder", "summary-viewer"]) {
        const value = (await client.query("select public.planning_deliverable_summaries($1,array['summary-parent'], $2, now()) as value", [actor, revision])).rows[0].value;
        expect(value.status).toBe("ready");
        expect(value.child_progress).toEqual({ "summary-parent": { completed: 1, total: 1, unfinished: 0, percentage: 100 } });
      }
      expect((await client.query("select public.planning_deliverable_summaries('unmapped',array['summary-parent'], $1, now()) as value", [revision])).rows[0].value).toEqual({ status: "forbidden" });
      expect((await client.query("select public.planning_deliverable_summaries('summary-viewer',array['summary-parent'], 'unverified', now()) as value")).rows[0].value).toEqual({ status: "staleContinuation" });
      expect((await client.query("select public.planning_deliverable_summaries('summary-viewer',array['missing'], $1, now()) as value", [revision])).rows[0].value).toEqual({ status: "staleContinuation" });
    } finally { await client.query("reset role"); }
  });
});
