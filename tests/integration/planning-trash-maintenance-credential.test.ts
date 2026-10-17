import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { importTestModule } from "../helpers/vitest-module.mjs";

it("keeps purge eligibility, the 25-root bound and lifecycle lease ownership through actual maintenance routes", async () => {
  const expectedDatabase = process.env.DISPOSABLE_DB_URL;
  if (!expectedDatabase || !["localhost", "127.0.0.1"].includes(new URL(expectedDatabase).hostname)) throw new Error("An explicitly guarded disposable database is required.");
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]);
  const local = JSON.parse(stdout);
  if (local.DB_URL !== expectedDatabase || !["localhost", "127.0.0.1"].includes(new URL(local.API_URL).hostname)) throw new Error("Disposable database target mismatch.");
  const database = new pg.Client(expectedDatabase);
  await database.connect();
  const originalFetch = globalThis.fetch;
  const prefix = `trash-maintenance-${randomUUID()}`;
  const profileId = `${prefix}-profile`, projectId = `${prefix}-project`;
  const eligible = Array.from({ length: 26 }, (_, index) => `${prefix}-eligible-${index}`);
  const blocked = `${prefix}-blocked`, future = `${prefix}-future`;
  const ids = [...eligible, blocked, future];
  try {
    const empty = await database.query("select (select count(*) from public.tasks) + (select count(*) from public.planning_github_lifecycle_outbox) + (select count(*) from public.planning_github_projection_outbox) as records");
    if (Number(empty.rows[0].records) !== 0) throw new Error("Cleanup validation requires an empty disposable task and queue dataset.");
    await database.query("insert into public.profiles(id,name,platform_role,org_role) values ($1,'Synthetic maintenance founder','founder','Founder')", [profileId]);
    await database.query("insert into public.projects(id,name) values ($1,'Synthetic maintenance project')", [projectId]);
    await database.query("select set_config('founderops.trash_lifecycle_write','on',false)");
    for (const id of [...eligible, future]) await database.query("insert into public.tasks(id,project_id,title,status,priority,task_type,approval_status,github_issue_sync_status,score_relevant,trashed_at,trashed_by,trash_reason,trash_cause,purge_after,trash_root_type,trash_root_id,trash_revision) values ($1,$2,'Synthetic trash root','Offen','Hoch','initiative','draft','not_applicable',false,now()-($4::int * interval '1 day'),$3,'Synthetic maintenance fixture','withdrawn',now()-($4::int * interval '1 day')+interval '90 days','initiative',$1,1)", [id, projectId, profileId, id === future ? 1 : 91]);
    await database.query("insert into public.tasks(id,project_id,title,status,priority,task_type,approval_status,github_repo,github_issue_sync_status,score_relevant,trashed_at,trashed_by,trash_reason,trash_cause,purge_after,trash_root_type,trash_root_id,trash_revision) values ($1,$2,'Synthetic blocked root','Offen','Hoch','deliverable','draft','findmydoc-platform/management','not_synced',false,now()-interval '91 days',$3,'Synthetic maintenance fixture','withdrawn',now()-interval '1 day','deliverable',$1,1)", [blocked, projectId, profileId]);
    const inserted = await database.query("insert into public.planning_github_lifecycle_outbox(root_type,root_id,root_trash_revision,task_id,action,source_type,source_revision,status) values ('deliverable',$1,1,$1,'close_not_planned','withdrawn',1,'pending') returning id", [blocked]);
    await database.query("select set_config('founderops.trash_lifecycle_write','off',false)");
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: local.API_URL, SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY,
      FOUNDEROPS_MAINTENANCE_SECRET: "synthetic-maintenance", CRON_SECRET: "synthetic-cron", FOUNDEROPS_DELIVERY_SECRET: "synthetic-delivery", FOUNDEROPS_PLATFORM_RELEASE_TOKEN: "synthetic-release" })) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).origin !== new URL(local.API_URL).origin) throw new Error("Unexpected external provider in maintenance test.");
      return originalFetch(request);
    });
    const purge = await importTestModule("src/app/api/maintenance/planning-trash/purge/route.ts", { "server-only": {} });
    const lifecycle = await importTestModule("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts", { "server-only": {} });
    const request = (secret = "synthetic-maintenance") => new NextRequest("https://app.example.test/api/maintenance/planning-trash/purge", { method: "POST", headers: { "x-founderops-maintenance-secret": secret } });
    expect((await purge.POST(request("synthetic-cron"))).status).toBe(401);
    const first = await purge.POST(request()); expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, purgedRoots: 25, purgedTasks: 25, blockedExpiredRoots: 1, hasMore: true });
    expect(await (await purge.POST(request())).json()).toMatchObject({ purgedRoots: 1, blockedExpiredRoots: 1 });
    expect((await database.query("select id from public.tasks where id=any($1) order by id", [ids])).rows.map(row => row.id)).toEqual([blocked, future].sort());
    const token = randomUUID();
    const rpc = (name: string, body: unknown, key = local.SERVICE_ROLE_KEY) => originalFetch(`${local.API_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const claimed = await rpc("claim_planning_github_lifecycle_jobs", { p_lock_token: token, p_limit: 25, p_lease_seconds: 120 });
    expect(claimed.ok).toBe(true);
    expect((await claimed.json()).map((job: { id: string }) => job.id)).toEqual([inserted.rows[0].id]);
    const foreign = await rpc("finalize_planning_github_lifecycle_job", { p_job_id: inserted.rows[0].id, p_lock_token: randomUUID(), p_succeeded: true, p_status_reason: "issue_missing" });
    expect((await foreign.json()).code).toBe("P0001");
    await database.query("update public.planning_github_lifecycle_outbox set locked_at=now()-interval '3 minutes' where id=$1", [inserted.rows[0].id]);
    const delivered = await lifecycle.POST(request()); expect(delivered.status).toBe(200);
    expect(await delivered.json()).toMatchObject({ claimed: 1, completed: 1, outstandingLifecycleJobs: 0 });
    const stale = await rpc("finalize_planning_github_lifecycle_job", { p_job_id: inserted.rows[0].id, p_lock_token: token, p_succeeded: true, p_status_reason: "issue_missing" });
    expect((await stale.json()).code).toBe("P0001");
    expect(await (await purge.POST(request())).json()).toMatchObject({ purgedRoots: 1, blockedExpiredRoots: 0, hasMore: false });
    expect(await (await purge.POST(request())).json()).toMatchObject({ purgedRoots: 0, purgedTasks: 0 });
    expect((await database.query("select id from public.tasks where id=any($1)", [ids])).rows).toEqual([{ id: future }]);
    const anonymous = await rpc("purge_expired_planning_trash_batch", { p_limit: 25, p_dry_run: false }, local.ANON_KEY);
    expect((await anonymous.json()).code).toBe("42501");
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await database.query("select set_config('founderops.trash_lifecycle_write','on',false)");
    await database.query("delete from public.planning_github_lifecycle_outbox where root_id=any($1)", [ids]);
    await database.query("delete from public.tasks where id=any($1)", [ids]);
    await database.query("delete from public.audit_log where entity_id=any($1)", [ids]);
    await database.query("delete from public.projects where id=$1", [projectId]);
    await database.query("delete from public.profiles where id=$1", [profileId]);
    await database.query("select set_config('founderops.trash_lifecycle_write','off',false)");
    await database.end();
  }
}, 30_000);
