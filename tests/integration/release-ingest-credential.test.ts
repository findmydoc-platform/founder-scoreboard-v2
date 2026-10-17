import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { platformReleaseFixture } from "../helpers/platform-release-fixture.mjs";
import { canonicalPlatformReleaseManifest } from "../../src/features/platform-releases/model/platform-release-manifest";

it("actual release ingest retains one immutable stored release and notification through identical retry and changed-manifest conflict", async () => {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]);
  const local = JSON.parse(stdout), api = new URL(local.API_URL), database = new URL(local.DB_URL);
  if (!["localhost", "127.0.0.1"].includes(api.hostname) || api.port !== "56321"
    || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "56322") throw Error("Disposable target required");
  const db = new pg.Client(local.DB_URL);
  await db.connect();
  const profileId = `release-ingest-${randomUUID()}`, version = `v999.0.${Date.now()}`;
  const manifest = platformReleaseFixture();
  manifest.version = version;
  for (const component of manifest.components) component.release = `https://github.com/${component.repository}/releases/tag/${version}`;
  manifest.manifestDigest = createHash("sha256").update(canonicalPlatformReleaseManifest(manifest)).digest("hex");
  const originalFetch = globalThis.fetch;
  let rpcCalls = 0;
  try {
    await db.query("insert into public.profiles(id,name,platform_role) values($1,'Synthetic release reader','viewer')", [profileId]);
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: local.API_URL, SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY, FOUNDEROPS_PLATFORM_RELEASE_TOKEN: "synthetic-ingest", VERCEL_ENV: "preview" })) vi.stubEnv(name, value as string);
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url !== `${local.API_URL}/rest/v1/rpc/ingest_platform_release_v1` || request.method !== "POST") throw Error("Unscripted protocol");
      rpcCalls++; return originalFetch(request);
    });
    vi.resetModules();
    const { POST } = await importTestModule("src/app/api/team/platform-releases/v1/releases/route.ts", { "server-only": {} });
    const request = (body = manifest, token = "synthetic-ingest") => new NextRequest("http://localhost:3000/api/team/platform-releases/v1/releases", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": `platform-release:${body.manifestDigest}` }, body: JSON.stringify(body),
    });
    const first = await POST(request()), replay = await POST(request());
    expect(first.status).toBe(201); expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, replayed: true });
    const changed = { ...manifest, summary: "Andere gültige Zusammenfassung." };
    changed.manifestDigest = createHash("sha256").update(canonicalPlatformReleaseManifest(changed)).digest("hex");
    expect((await POST(request(changed))).status).toBe(409);
    expect((await POST(request(manifest, "wrong"))).status).toBe(401);
    expect(rpcCalls).toBe(3);
    expect((await db.query("select manifest from public.platform_releases where version=$1", [version])).rows).toEqual([{ manifest }]);
    expect((await db.query("select count(*)::int as count from public.notification_events where entity_type='platform_release' and entity_id=$1 and recipient_profile_id=$2", [version, profileId])).rows[0].count).toBe(1);
    expect((await db.query("select has_function_privilege('anon','public.ingest_platform_release_v1(jsonb)','EXECUTE') as anonymous,has_function_privilege('authenticated','public.ingest_platform_release_v1(jsonb)','EXECUTE') as authenticated,has_function_privilege('service_role','public.ingest_platform_release_v1(jsonb)','EXECUTE') as server")).rows[0]).toEqual({ anonymous: false, authenticated: false, server: true });
    const denied = await originalFetch(`${local.API_URL}/rest/v1/rpc/ingest_platform_release_v1`, { method: "POST", headers: { apikey: local.ANON_KEY, authorization: `Bearer ${local.ANON_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ p_manifest: manifest }) });
    expect([401, 403]).toContain(denied.status);
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules();
    await db.query("delete from public.notification_events where entity_type='platform_release' and entity_id=$1", [version]);
    await db.query("delete from public.platform_releases where version=$1", [version]);
    await db.query("delete from public.profiles where id=$1", [profileId]);
    await db.end();
  }
}, 30000);
