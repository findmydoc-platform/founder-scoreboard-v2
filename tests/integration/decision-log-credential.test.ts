import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";

it("the actual Decision Log page retains mapped-reader header restrictions with isolated Auth and database storage", async () => {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]);
  const local = JSON.parse(stdout);
  const api = new URL(local.API_URL), database = new URL(local.DB_URL);
  if (!["localhost", "127.0.0.1"].includes(api.hostname) || api.port !== "56321"
    || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "56322") throw Error("Disposable target required");
  const db = new pg.Client(local.DB_URL);
  await db.connect();
  const id = `decision-reader-${randomUUID()}`, foreign = `decision-foreign-${randomUUID()}`;
  let userId: string | undefined;
  const originalFetch = globalThis.fetch;
  const configuration = (await db.query("select mode,linking_enforced from workspace_private.configuration")).rows[0];
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const cookies = new Map<string, string>();
  const jar = { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), set: (name: string, value: string, options?: { maxAge?: number }) => { if (options?.maxAge === 0) cookies.delete(name); else cookies.set(name, value); } };
  let notionCalls = 0;
  try {
    await db.query("update workspace_private.configuration set mode='legacy',linking_enforced=false");
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, options);
    const auth = createClient(local.API_URL, local.ANON_KEY, options);
    const email = `${id}@example.test`, password = randomUUID();
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    userId = created.data.user!.id;
    const signedIn = await auth.auth.signInWithPassword({ email, password });
    expect(signedIn.error).toBeNull();
    expect(signedIn.data.session).not.toBeNull();
    cookies.set(`sb-${api.hostname.split(".")[0]}-auth-token`, `base64-${encode(signedIn.data.session)}`);
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,'Synthetic reader','viewer'),($3,null,'Synthetic foreign','viewer')", [id, userId, foreign]);
    for (const [recipient, title] of [[id, "Own"], [foreign, "Foreign"], [null, "Lead only"]]) {
      await db.query("insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,dedupe_key) values('synthetic.decision','synthetic',$1,$2,$3,$4)", [id, title, recipient, `${id}:${title}`]);
    }
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: local.API_URL, SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY, REQUIRE_SUPABASE_AUTH: "true", VERCEL_ENV: "preview",
      NOTION_DECISION_LOG_ENABLED: "true", NOTION_DECISION_LOG_TOKEN: "synthetic-notion", NOTION_DECISION_LOG_DATA_SOURCE_ID: "fixed-test-source" })) vi.stubEnv(name, value as string);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.origin === api.origin) return originalFetch(request);
      if (url.href !== "https://api.notion.com/v1/data_sources/fixed-test-source/query") throw Error("Unscripted provider");
      expect(request.headers.get("authorization")).toBe("Bearer synthetic-notion"); notionCalls++;
      return Response.json({ results: [{ object: "page", id: "decision-1", properties: {}, url: "https://notion.so/decision-1" }], has_more: false });
    });
    vi.resetModules();
    const { default: DecisionLogPage } = await importTestModule("src/app/(workspaces)/decision-log/page.tsx", {
      "server-only": {}, "next/headers": { cookies: async () => jar, headers: async () => new Headers({ host: "localhost:3000" }) },
      "next/cache": { unstable_cache: (fn: unknown) => fn, revalidateTag() {} },
      "@/features/planning/PlanningApp": { PlanningApp() { return null; } },
    });
    const viewer = await DecisionLogPage();
    expect(viewer.props.initialDecisionLogResult).toMatchObject({ ok: true, entries: [{ id: "decision-1" }] });
    expect(viewer.props.initialHeaderData.notifications.data.items.map((item: { title: string }) => item.title)).toEqual(["Own"]);
    await db.query("update public.profiles set platform_role='deputy' where id=$1", [id]);
    const deputy = await DecisionLogPage();
    expect(deputy.props.initialHeaderData.notifications.data.items.map((item: { title: string }) => item.title).sort()).toEqual(["Lead only", "Own"]);
    await db.query("update public.profiles set auth_user_id=null where id=$1", [id]);
    const denied = await DecisionLogPage();
    expect(denied.props.initialProtectedDataLoaded).not.toBe(true);
    expect(notionCalls).toBe(2);
    expect(JSON.stringify([viewer.props, deputy.props, denied.props])).not.toContain("synthetic-notion");
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules();
    await db.query("delete from public.notification_events where entity_type='synthetic' and entity_id=$1", [id]);
    await db.query("delete from public.profiles where id=any($1)", [[id, foreign]]);
    if (userId) await db.query("delete from auth.users where id=$1", [userId]);
    await db.query("update workspace_private.configuration set mode=$1,linking_enforced=$2", [configuration.mode, configuration.linking_enforced]);
    await db.end();
  }
}, 30000);
