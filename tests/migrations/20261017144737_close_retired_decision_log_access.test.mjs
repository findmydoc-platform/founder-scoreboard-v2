import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, assertRowsPreserved, resetLocalDatabaseTo, snapshotRows, withLocalDatabase } from "./helpers/migration-test-harness.mjs";
import { asAuthenticated, captureDatabaseError } from "../integration/helpers/local-database";
import { verifyCatalogSecurity } from "../../scripts/lib/database-security/catalog-security.mjs";
import { localSupabaseStatus } from "../helpers/local-supabase-target.mjs";

const migrationFile = resolve("supabase/migrations/20261017144737_close_retired_decision_log_access.sql");
const columns = {
  decision_log: ["id", "title", "context", "decision", "status", "required_profile_ids", "created_by", "locked_at", "created_at", "updated_at"],
  decision_comments: ["id", "decision_id", "profile_id", "type", "comment", "created_at"],
  decision_confirmations: ["id", "decision_id", "profile_id", "confirmed_at"],
  decision_task_links: ["id", "decision_id", "task_id", "link_type", "note", "created_by", "created_at"],
};
const tables = Object.keys(columns);
async function catalogFailures(client) {
  const failures = [];
  await verifyCatalogSecurity(client, failures);
  return failures;
}
async function snapshot(client) {
  const data = {};
  for (const table of tables) data[table] = await snapshotRows(client, { table, columns: columns[table], orderBy: ["id"] });
  const sequences = {};
  for (const table of tables) sequences[table] = {
    owned: (await client.query("select pg_get_serial_sequence($1,'id') as name", [`public.${table}`])).rows[0].name,
    state: (await client.query(`select last_value,is_called from public.${table}_id_seq`)).rows[0],
  };
  const foreignKeys = (await client.query("select conname,conrelid::regclass::text as source,confrelid::regclass::text as target,confupdtype,confdeltype,convalidated from pg_constraint where contype='f' and conrelid=any($1::regclass[]) order by conname", [tables.map(table => `public.${table}`)])).rows;
  const rls = (await client.query("select relname,relrowsecurity,relforcerowsecurity from pg_class where oid=any($1::regclass[]) order by relname", [tables.map(table => `public.${table}`)])).rows;
  const boundaries = (await client.query("select tablename,policyname,roles,cmd from pg_policies where schemaname='public' and tablename=any($1) and permissive='RESTRICTIVE' order by tablename,policyname", [tables])).rows;
  const serviceGrants = (await client.query("select object,privilege,has_table_privilege('service_role',object,privilege) as allowed from unnest($1::text[]) object cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) privilege order by object,privilege", [tables.map(table => `public.${table}`)])).rows;
  const serviceSequences = (await client.query("select object,privilege,has_sequence_privilege('service_role',object,privilege) as allowed from unnest($1::text[]) object cross join unnest(array['USAGE','SELECT','UPDATE']) privilege order by object,privilege", [tables.map(table => `public.${table}_id_seq`)])).rows;
  return { data, sequences, foreignKeys, rls, boundaries, serviceGrants, serviceSequences };
}

it.sequential("closes retired Decision Log access without changing rows, foreign keys, sequences, RLS or service privileges", { timeout: 120000 }, async () => {
  await localSupabaseStatus();
  await resetLocalDatabaseTo("20261017100804");
  await withLocalDatabase(async client => {
    const suffix = randomUUID();
    const actors = ["ceo", "founder", "deputy", "viewer", "administrator", "unmapped"].map(role => ({ role, user: randomUUID(), profile: `decision-migration-${role}-${suffix}` }));
    const ceo = actors[0], administrator = actors[4];
    await client.query("update workspace_private.configuration set mode='legacy',linking_enforced=false where singleton");
    for (const actor of actors) {
      await client.query("insert into auth.users(id) values($1)", [actor.user]);
      if (actor.role !== "unmapped") await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,'Synthetic migration actor',$3)", [actor.profile, actor.user, actor.role === "administrator" ? "viewer" : actor.role]);
    }
    await client.query("insert into public.administrator_access_grants(profile_id,eligible) values($1,true)", [administrator.profile]);
    await client.query("begin");
    expect((await asAuthenticated(client, administrator.user, () => client.query("select public.activate_administrator_access() as access"))).rows[0].access.active).toBe(true);
    await client.query("commit");
    const project = `decision-project-${suffix}`, task = `decision-task-${suffix}`;
    await client.query("insert into public.projects(id,name) values($1,'Synthetic migration project')", [project]);
    await client.query("insert into public.tasks(id,project_id,title,status,task_type,priority,github_repo,approval_status,score_relevant) values($1,$2,'Synthetic linked task','Offen','deliverable','P1','findmydoc-platform/management','draft',false)", [task, project]);
    const decision = (await client.query("insert into public.decision_log(title,context,decision,status,required_profile_ids,created_by) values('Preserved title','Preserved context','Preserved decision','open_for_confirmation',$1,$2) returning id", [[ceo.profile], ceo.profile])).rows[0].id;
    await client.query("insert into public.decision_comments(decision_id,profile_id,type,comment) values($1,$2,'objection','Preserved objection')", [decision, ceo.profile]);
    await client.query("insert into public.decision_confirmations(decision_id,profile_id) values($1,$2)", [decision, ceo.profile]);
    await client.query("insert into public.decision_task_links(decision_id,task_id,created_by,note) values($1,$2,$3,'Preserved explanation')", [decision, task, ceo.profile]);
    const before = await snapshot(client);
    expect(before.foreignKeys).toHaveLength(8);
    expect(before.boundaries).toHaveLength(4);
    await client.query("begin");
    expect((await asAuthenticated(client, ceo.user, () => client.query("select title from public.decision_log where id=$1", [decision]))).rows).toEqual([{ title: "Preserved title" }]);
    await client.query("rollback");
    expect((await catalogFailures(client)).some(failure => failure.includes("authenticated:decision_log:SELECT"))).toBe(true);

    await applyMigration(client, migrationFile);
    assertRowsPreserved(before, await snapshot(client));
    expect(await catalogFailures(client)).toEqual([]);
    for (const actor of actors) {
      await client.query("begin");
      try {
        for (const table of tables) {
          expect(await captureDatabaseError(client, () => asAuthenticated(client, actor.user, () => client.query(`select id from public.${table}`)))).toMatchObject({ code: "42501" });
          expect(await captureDatabaseError(client, () => asAuthenticated(client, actor.user, () => client.query(`select nextval('public.${table}_id_seq')`)))).toMatchObject({ code: "42501" });
        }
        expect(await captureDatabaseError(client, () => asAuthenticated(client, actor.user, () => client.query("insert into public.decision_log(title,created_by) values('Denied creation',$1)", [ceo.profile])))).toMatchObject({ code: "42501" });
      } finally { await client.query("rollback"); }
    }
    for (const statement of [
      "grant select on public.decision_log to authenticated",
      "grant usage on sequence public.decision_log_id_seq to public",
      "create policy accidental_human_read on public.decision_comments for select to authenticated using (public.current_profile_id() is not null)",
      "revoke select on public.decision_comments from service_role",
    ]) {
      await client.query("begin");
      try {
        await client.query(statement);
        const failures = await catalogFailures(client);
        if (statement.startsWith("grant select")) expect(failures.some(failure => failure.includes("authenticated:decision_log:SELECT"))).toBe(true);
        if (statement.startsWith("grant usage")) expect(failures.some(failure => failure.includes("unsafe client sequence privileges") && failure.includes("decision_log_id_seq"))).toBe(true);
        if (statement.startsWith("create policy")) expect(failures.some(failure => failure.includes("service-role-only tables with RLS policies") && failure.includes("accidental_human_read"))).toBe(true);
        if (statement.startsWith("revoke select")) expect(failures).toContain("missing service-role-only table privilege: service_role:decision_comments:SELECT");
      } finally { await client.query("rollback"); }
    }
    expect(await catalogFailures(client)).toEqual([]);
    await applyMigration(client, migrationFile);
    assertRowsPreserved(before, await snapshot(client));
  });
});
