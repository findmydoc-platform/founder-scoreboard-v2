import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { importTestModule } from "../helpers/vitest-module.mjs";

it("the real Cron entry preserves foreign leases, reclaims stale work and processes pending deliveries once", async () => {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]);
  const local = JSON.parse(stdout);
  if (!new Set(["localhost", "127.0.0.1"]).has(new URL(local.API_URL).hostname)) throw new Error("Disposable local test target required");
  const database = new pg.Client(local.DB_URL);
  await database.connect();
  const originalFetch = globalThis.fetch;
  const prefix = `synthetic-cron-${randomUUID()}`;
  const ids = [`${prefix}-foreign`, `${prefix}-stale`, `${prefix}-pending`];
  const foreignLock = randomUUID();
  try {
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: local.API_URL, SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY, CRON_SECRET: "synthetic-cron-secret", GITHUB_APP_ID: "", GITHUB_APP_INSTALLATION_ID: "", GITHUB_APP_PRIVATE_KEY: "", GITHUB_APP_PRIVATE_KEY_PATH: "" })) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).origin !== new URL(local.API_URL).origin) throw new Error("Unexpected external provider in Cron parity test");
      return originalFetch(request);
    });
    for (let index = 0; index < ids.length; index++) {
      await database.query(`insert into public.github_webhook_deliveries
        (delivery_id,event_name,action,installation_id,repository_id,repository_full_name,issue_id,issue_node_id,issue_number,issue_updated_at,payload_sha256,comment_id,comment_node_id,comment_updated_at,status,attempts,locked_at,lock_token)
        values ($1,'issue_comment','deleted',42,101,'findmydoc-platform/management',202,'I_synthetic',2000000000,now(),$2,404,'IC_synthetic',now(),$3,$4,$5,$6)`,
      [ids[index], "a".repeat(64), index < 2 ? "processing" : "received", index < 2 ? 1 : 0, index < 2 ? new Date(Date.now() - (index === 1 ? 180000 : 0)) : null, index < 2 ? foreignLock : null]);
    }
    const route = await importTestModule("src/app/api/maintenance/github-webhooks/route.ts", { "server-only": {} });
    const request = (secret = "synthetic-cron-secret") => new NextRequest("https://app.example.test/api/maintenance/github-webhooks", { headers: { authorization: `Bearer ${secret}` } });
    expect((await route.GET(request("wrong-synthetic-secret"))).status).toBe(401);
    const first = await route.GET(request());
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ comments: { claimed: 2, ignored: 2 } });
    const rows = (await database.query("select delivery_id,status,status_reason,attempts,lock_token from public.github_webhook_deliveries where delivery_id=any($1) order by delivery_id", [ids])).rows;
    expect(rows.find(row => row.delivery_id === ids[0])).toMatchObject({ status: "processing", attempts: 1, lock_token: foreignLock });
    expect(rows.find(row => row.delivery_id === ids[1])).toMatchObject({ status: "ignored", status_reason: "task_not_found", attempts: 2, lock_token: null });
    expect(rows.find(row => row.delivery_id === ids[2])).toMatchObject({ status: "ignored", status_reason: "task_not_found", attempts: 1, lock_token: null });
    const repeated = await route.GET(request());
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ comments: { claimed: 0 } });
    const denied = await originalFetch(`${local.API_URL}/rest/v1/rpc/claim_github_issue_comment_webhook_delivery`, { method: "POST", headers: { apikey: local.ANON_KEY, authorization: `Bearer ${local.ANON_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ p_delivery_id: ids[0], p_lock_token: randomUUID(), p_lease_seconds: 120 }) });
    expect([401, 403]).toContain(denied.status);
    expect((await database.query("select public.finalize_github_issue_comment_webhook_delivery($1,$2,'ignored','synthetic_foreign',null,null) as finalized", [ids[0], randomUUID()])).rows[0].finalized).toBe(false);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await database.query("delete from public.github_webhook_deliveries where delivery_id=any($1)", [ids]);
    await database.end();
  }
}, 30000);
