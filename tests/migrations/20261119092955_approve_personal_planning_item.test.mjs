import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

const migration = resolve("supabase/migrations/20261119092955_approve_personal_planning_item.sql");
const rpc = "select public.approve_team_planning_item_transaction($1,$2,$3,$4,$5) as result";

it("restricts personal approvals and records exactly one decision for a replay", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261107012620");
  await withLocalDatabase(async client => {
    const actor = randomUUID(), deputy = randomUUID(), founder = randomUUID();
    for (const [id, user, role] of [["approval-ceo", actor, "ceo"], ["approval-deputy", deputy, "deputy"], ["approval-founder", founder, "founder"]]) {
      await client.query("insert into auth.users(id) values($1)", [user]);
      await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,$1,$3)", [id, user, role]);
    }
    await client.query("insert into public.profiles(id,name,platform_role) values('approval-unmapped','Unmapped','ceo')");
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic project')");
    await client.query("insert into public.tasks(id,project_id,title,status,priority,task_type,approval_status,score_relevant,github_issue_sync_status) values ('approval-epic','findmydoc-founder-execution','Epic','Offen',null,'epic',null,false,'not_applicable'), ('approval-initiative','findmydoc-founder-execution','Initiative','Offen','P2','initiative','proposed',false,'not_applicable')");
    await client.query("update public.tasks set parent_task_id='approval-epic' where id='approval-initiative'");
    await client.query("insert into public.planning_item_raci_assignments(task_id,profile_id,role) values ('approval-initiative','approval-ceo','accountable'),('approval-initiative','approval-deputy','responsible')");
    const tokens = {};
    for (const [i, profile] of ["approval-ceo", "approval-deputy", "approval-founder", "approval-unmapped"].entries()) {
      const id = randomUUID(); tokens[profile] = id;
      await client.query("insert into public.team_task_intake_tokens(id,profile_id,label,token_hash,token_hint,expires_at) values($1,$2,'Synthetic',$3,'hint',now()+interval '1 day')", [id, profile, String(i + 1).repeat(64)]);
    }
    const existing = (await client.query("select * from public.tasks where id='approval-initiative'")).rows;
    await applyMigration(client, migration);
    expect((await client.query("select * from public.tasks where id='approval-initiative'")).rows).toEqual(existing);
    const key = randomUUID();
    const call = async (profile, item, revision, idempotencyKey = randomUUID(), token = tokens[profile]) => (await client.query(rpc, [token, profile, item, revision, idempotencyKey])).rows[0].result;
    for (const role of ["anon", "authenticated"]) {
      expect((await client.query("select has_function_privilege($1,'public.approve_team_planning_item_transaction(uuid,text,text,integer,uuid)','execute') as allowed", [role])).rows[0].allowed).toBe(false);
      expect((await client.query("select has_table_privilege($1,'public.team_planning_item_approval_requests','select') as allowed", [role])).rows[0].allowed).toBe(false);
      await client.query(`set role ${role}`);
      try { await expect(call("approval-ceo", "approval-initiative", 1)).rejects.toMatchObject({ code: "42501" }); }
      finally { await client.query("reset role"); }
    }
    await expect(call("approval-founder", "approval-initiative", 1)).rejects.toMatchObject({ code: "P0006" });
    await expect(call("approval-unmapped", "approval-initiative", 1)).rejects.toMatchObject({ code: "P0006" });
    await expect(call("approval-deputy", "approval-initiative", 1, randomUUID(), tokens["approval-ceo"])).rejects.toMatchObject({ code: "P0004" });
    await expect(call("approval-ceo", "approval-epic", 1)).rejects.toMatchObject({ code: "P0002" });
    await expect(call("approval-ceo", "approval-initiative", 2)).rejects.toMatchObject({ code: "P0001" });
    await client.query("insert into public.tasks(id,project_id,title,status,priority,task_type,approval_status,score_relevant,github_issue_sync_status) values('approval-no-parent','findmydoc-founder-execution','No parent','Offen','P2','initiative','proposed',false,'not_applicable')");
    await expect(call("approval-ceo", "approval-no-parent", 1)).rejects.toMatchObject({ code: "23514" });
    await client.query("insert into public.tasks(id,project_id,title,status,priority,task_type,approval_status,parent_task_id,score_relevant,github_repo) values('approval-unapproved-parent','findmydoc-founder-execution','Unapproved parent','Offen','P2','deliverable','proposed','approval-initiative',false,'findmydoc-platform/management')");
    await expect(call("approval-deputy", "approval-unapproved-parent", 1)).rejects.toMatchObject({ code: "23514" });
    expect((await client.query("select count(*)::int as count from public.task_activity where task_id in ('approval-no-parent','approval-unapproved-parent')")).rows[0].count).toBe(0);
    await client.query("delete from public.planning_item_raci_assignments where task_id='approval-initiative' and role='responsible'");
    await expect(call("approval-ceo", "approval-initiative", 1)).rejects.toMatchObject({ code: "23514" });
    expect((await client.query("select approval_status from public.tasks where id='approval-initiative'")).rows[0].approval_status).toBe("proposed");
    await client.query("insert into public.planning_item_raci_assignments(task_id,profile_id,role) values('approval-initiative','approval-deputy','responsible')");
    const first = await call("approval-ceo", "approval-initiative", 1, key);
    expect(first).toMatchObject({ replayed: false, task: { id: "approval-initiative", approval_status: "approved", approval_revision: 2, decided_by: "approval-ceo" } });
    expect(await call("approval-ceo", "approval-initiative", 1, key)).toEqual({ ...first, replayed: true });
    await expect(call("approval-ceo", "approval-initiative", 2, key)).rejects.toMatchObject({ code: "P0020" });
    await expect(call("approval-ceo", "approval-initiative", 1)).rejects.toMatchObject({ code: "P0001" });
    expect((await client.query("select count(*)::int as count from public.task_activity where task_id='approval-initiative'")).rows[0].count).toBe(1);
    expect((await client.query("select count(*)::int as count from public.audit_log where entity_id='approval-initiative' and action='planning_item.approval_approve' and actor_profile_id='approval-ceo'")).rows[0].count).toBe(1);
    await client.query("update public.profiles set platform_role='founder' where id='approval-ceo'");
    await expect(call("approval-ceo", "approval-initiative", 1, key)).rejects.toMatchObject({ code: "P0006" });
    await client.query("update public.profiles set platform_role='ceo' where id='approval-ceo'");
    await client.query("update public.team_task_intake_tokens set revoked_at=now() where id=$1", [tokens["approval-ceo"]]);
    await expect(call("approval-ceo", "approval-initiative", 1, key)).rejects.toMatchObject({ code: "P0004" });
    await client.query("insert into public.tasks(id,project_id,title,status,priority,task_type,approval_status,parent_task_id,score_relevant,github_repo) values('approval-deliverable','findmydoc-founder-execution','Deliverable','Offen','P2','deliverable','proposed','approval-initiative',false,'findmydoc-platform/management')");
    await client.query("update public.tasks set review_status='requested', evidence_link='https://example.test/evidence' where id='approval-deliverable'");
    await expect(call("approval-deputy", "approval-deliverable", 1)).rejects.toMatchObject({ code: "P0009" });
    await client.query("update public.tasks set review_status='not_requested' where id='approval-deliverable'");
    await client.query("update public.team_task_intake_tokens set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where id=$1", [tokens["approval-deputy"]]);
    await expect(call("approval-deputy", "approval-deliverable", 1)).rejects.toMatchObject({ code: "P0004" });
    await client.query("update public.team_task_intake_tokens set expires_at=now()+interval '1 day' where id=$1", [tokens["approval-deputy"]]);
    expect(await call("approval-deputy", "approval-deliverable", 1)).toMatchObject({ replayed: false, task: { approval_status: "approved", decided_by: "approval-deputy" } });
    for (const id of ["approval-race-replay", "approval-race-conflict"]) {
      await client.query("insert into public.tasks(id,project_id,title,status,priority,task_type,approval_status,parent_task_id,score_relevant,github_repo) values($1,'findmydoc-founder-execution','Concurrent','Offen','P2','deliverable','proposed','approval-initiative',false,'findmydoc-platform/management')", [id]);
    }
    await withLocalDatabase(async other => {
      const run = (connection, item, raceKey) => connection.query(rpc, [tokens["approval-deputy"], "approval-deputy", item, 1, raceKey]);
      const raceKey = randomUUID();
      const replay = await Promise.all([run(client, "approval-race-replay", raceKey), run(other, "approval-race-replay", raceKey)]);
      expect(replay.map(result => result.rows[0].result.replayed).sort()).toEqual([false, true]);
      const conflict = await Promise.allSettled([run(client, "approval-race-conflict", randomUUID()), run(other, "approval-race-conflict", randomUUID())]);
      expect(conflict.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(conflict.find(result => result.status === "rejected").reason).toMatchObject({ code: "P0001" });
    });
    for (const item of ["approval-race-replay", "approval-race-conflict"]) {
      expect((await client.query("select count(*)::int as count from public.task_activity where task_id=$1", [item])).rows[0].count).toBe(1);
    }
  });
});
