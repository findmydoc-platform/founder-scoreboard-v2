import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

const filename = "20261028014717_backlog_assignment_sprint_compare_and_set.sql";
const directory = resolve("supabase/migrations");
const previousVersion = readdirSync(directory).filter(name => name.endsWith(".sql") && name < filename).sort().at(-1).slice(0, 14);
const migration = resolve(directory, filename);
const users = Object.fromEntries(["ceo", "founder", "deputy", "viewer", "administrator", "unmapped"].map((role, index) => [role, `74000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`]));

async function asRole(client, role, user, action) {
  await client.query("begin");
  try {
    await client.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role',$3,true)", [JSON.stringify({ role, ...(user ? { sub: user } : {}) }), user || "", role]);
    await client.query(`set local role ${role}`);
    const result = await action();
    await client.query("commit");
    return result;
  } catch (error) { await client.query("rollback"); throw error; }
}
const revision = async (client, table, id) => (await client.query(`select updated_at::text as revision from public.${table} where id=$1`, [id])).rows[0].revision;
async function snapshot(client) {
  const result = {};
  for (const table of ["tasks", "sprints", "profiles", "audit_log", "notification_events"]) result[table] = (await client.query(`select to_jsonb(row) as data from public.${table} row order by to_jsonb(row)::text`)).rows;
  result.grants = (await client.query("select proname,proacl::text from pg_proc where pronamespace='public'::regnamespace and proname=any($1) order by proname", [["assign_backlog_tasks_to_sprint_transaction", "update_browser_planning_task_transaction_v2", "update_administrator_planning_task_transaction_v2"]])).rows;
  return result;
}
const bulk = (client, id, taskRevision, sprintRevision, actor = "assignment-ceo") => asRole(client, "service_role", null, () => client.query("select public.assign_backlog_tasks_to_sprint_transaction($1::jsonb,'assignment-sprint',$2,null,null) as result", [JSON.stringify([{ taskId: id, expectedUpdatedAt: taskRevision, ...(sprintRevision === undefined ? {} : { expectedSprintUpdatedAt: sprintRevision }) }]), actor]));
const single = (client, id, taskRevision, sprintRevision, role = "service_role", user = null, administrator = false) => {
  const patch = { sprint_id: "assignment-sprint", score_relevant: true, ...(sprintRevision === undefined ? {} : { __expected_sprint_updated_at: sprintRevision }) };
  const rpc = administrator ? "update_administrator_planning_task_transaction_v2" : "update_browser_planning_task_transaction_v2";
  return asRole(client, role, user, () => client.query(`select public.${rpc}($1,$2,$3::jsonb,false,null,false,null,'{}'::text[],'[]'::jsonb${administrator ? "" : ",$4"}) as result`, [id, taskRevision, JSON.stringify(patch), ...(administrator ? [] : ["assignment-ceo"])]));
};

it("preserves assignment data and atomically checks the displayed target Sprint in both existing write paths", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo(previousVersion);
  await withLocalDatabase(async client => {
    await client.query("insert into auth.users(id) select unnest($1::uuid[])", [Object.values(users)]);
    for (const role of ["ceo", "founder", "deputy", "viewer", "administrator"]) await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,$3,$4)", [`assignment-${role}`, users[role], role, role === "administrator" ? "founder" : role]);
    await client.query("insert into public.administrator_access_grants(profile_id,eligible,active_until) values('assignment-administrator',true,clock_timestamp()+interval '1 hour')");
    await client.query("insert into public.projects(id,name) values('assignment-project','Assignment CAS fixture')");
    await client.query("insert into public.sprints(id,project_id,name,start_date,end_date) values('assignment-sprint','assignment-project','Target','2026-10-01','2026-10-07')");
    await client.query("insert into public.tasks(id,project_id,title,status,priority,owner,assignee,task_type,approval_status) values('assignment-initiative','assignment-project','Initiative','Offen','P2','assignment-founder','assignment-founder','initiative','approved')");
    for (const name of ["single", "bulk", "admin", "legacy", "race-single", "race-bulk"]) await client.query("insert into public.tasks(id,project_id,title,status,priority,owner,assignee,task_type,approval_status,parent_task_id,score_relevant) values($1,'assignment-project',$1,'Offen','P2','assignment-founder','assignment-founder','deliverable','approved','assignment-initiative',false)", [`assignment-${name}`]);
    const before = await snapshot(client);
    await applyMigration(client, migration);
    expect(await snapshot(client)).toEqual(before);
    const oldSprint = await revision(client, "sprints", "assignment-sprint");
    await client.query("update public.sprints set end_date='2026-10-08',updated_at=clock_timestamp() where id='assignment-sprint'");
    const sprint = await revision(client, "sprints", "assignment-sprint");
    const unchanged = await snapshot(client);
    for (const [name, write] of [["single", single], ["bulk", bulk]]) await expect(write(client, `assignment-${name}`, await revision(client, "tasks", `assignment-${name}`), oldSprint)).rejects.toMatchObject({ code: "P0018" });
    await expect(single(client, "assignment-admin", await revision(client, "tasks", "assignment-admin"), oldSprint, "authenticated", users.administrator, true)).rejects.toMatchObject({ code: "P0018" });
    expect(await snapshot(client)).toEqual(unchanged);

    await single(client, "assignment-single", await revision(client, "tasks", "assignment-single"), sprint);
    await bulk(client, "assignment-bulk", await revision(client, "tasks", "assignment-bulk"), sprint);
    await single(client, "assignment-admin", await revision(client, "tasks", "assignment-admin"), sprint, "authenticated", users.administrator, true);
    expect((await client.query("select id,sprint_id,score_relevant from public.tasks where id=any($1) order by id", [["assignment-single", "assignment-bulk", "assignment-admin"]])).rows).toEqual(["admin", "bulk", "single"].map(name => ({ id: `assignment-${name}`, sprint_id: "assignment-sprint", score_relevant: true })));
    await bulk(client, "assignment-legacy", await revision(client, "tasks", "assignment-legacy"), undefined);
    await single(client, "assignment-legacy", await revision(client, "tasks", "assignment-legacy"), undefined);

    for (const role of Object.keys(users)) {
      await expect(bulk(client, "assignment-race-bulk", await revision(client, "tasks", "assignment-race-bulk"), oldSprint, `assignment-${role}`)).rejects.toMatchObject({ code: role === "ceo" || role === "deputy" ? "P0018" : "P0015" });
    }
    for (const role of ["ceo", "founder", "deputy", "viewer", "unmapped"]) {
      await expect(single(client, "assignment-race-single", await revision(client, "tasks", "assignment-race-single"), sprint, "authenticated", users[role])).rejects.toMatchObject({ code: "42501" });
      await expect(single(client, "assignment-race-single", await revision(client, "tasks", "assignment-race-single"), sprint, "authenticated", users[role], true)).rejects.toMatchObject({ code: "42501" });
      await expect(asRole(client, "authenticated", users[role], () => client.query("select public.assign_backlog_tasks_to_sprint_transaction('[]'::jsonb,'assignment-sprint','assignment-ceo',null,null)"))).rejects.toMatchObject({ code: "42501" });
    }
    await expect(single(client, "assignment-race-single", await revision(client, "tasks", "assignment-race-single"), sprint, "anon")).rejects.toMatchObject({ code: "42501" });
    await expect(single(client, "assignment-race-single", await revision(client, "tasks", "assignment-race-single"), sprint, "anon", null, true)).rejects.toMatchObject({ code: "42501" });

    for (const [name, write] of [["single", single], ["bulk", bulk]]) {
      const id = `assignment-race-${name}`;
      const taskBefore = (await client.query("select to_jsonb(task) as data from public.tasks task where id=$1", [id])).rows;
      const auditBefore = (await client.query("select count(*)::int as count from public.audit_log")).rows[0].count;
      const taskVersion = await revision(client, "tasks", id);
      const displayedSprintVersion = await revision(client, "sprints", "assignment-sprint");
      await client.query("begin");
      let released = false;
      let processId;
      let pending;
      try {
        await client.query("update public.sprints set name=name||' changed',updated_at=clock_timestamp() where id='assignment-sprint'");
        pending = withLocalDatabase(async other => {
          processId = (await other.query("select pg_backend_pid() as id")).rows[0].id;
          return write(other, id, taskVersion, displayedSprintVersion);
        }).then(value => ({ ok: true, value }), error => ({ ok: false, code: error.code }));
        let blocked = false;
        for (let attempt = 0; attempt < 200; attempt++) {
          if (processId && (await client.query("select cardinality(pg_blocking_pids($1))>0 as blocked", [processId])).rows[0].blocked) { blocked = true; break; }
          await new Promise(resolveWait => setTimeout(resolveWait, 20));
        }
        expect(blocked).toBe(true);
        await withLocalDatabase(other => other.query("select id from public.tasks where id=$1 for update nowait", [id]));
        await client.query("commit");
        released = true;
        expect(await pending).toMatchObject({ ok: false, code: "P0018" });
      } finally {
        if (!released) await client.query("rollback");
        if (pending) await pending;
      }
      expect((await client.query("select to_jsonb(task) as data from public.tasks task where id=$1", [id])).rows).toEqual(taskBefore);
      expect((await client.query("select count(*)::int as count from public.audit_log")).rows[0].count).toBe(auditBefore);
    }
    const preserved = await snapshot(client);
    await applyMigration(client, migration);
    expect(await snapshot(client)).toEqual(preserved);
  });
});
