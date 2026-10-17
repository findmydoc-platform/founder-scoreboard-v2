import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { platformReleaseFixture } from "../../helpers/platform-release-fixture.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { createHash } from "node:crypto";

const origin = "https://release-storage.example.test";
let mutations, stored, network;
beforeEach(() => {
  vi.resetModules(); mutations = []; stored = new Map();
  for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: origin, SUPABASE_URL: origin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_PUBLISHABLE_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", SUPABASE_SECRET_KEY: "synthetic-service", FOUNDEROPS_PLATFORM_RELEASE_TOKEN: "synthetic-ingest", REQUIRE_SUPABASE_AUTH: "true", VERCEL_ENV: "preview" })) vi.stubEnv(name, value);
  network = async request => {
    if (request.url !== `${origin}/rest/v1/rpc/ingest_platform_release_v1` || request.method !== "POST") throw Error("Unscripted protocol");
    mutations.push(request);
    expect(request.headers.get("authorization")).toBe("Bearer synthetic-service");
    const manifest = (await request.clone().json()).p_manifest;
    if (stored.has(manifest.version)) {
      if (stored.get(manifest.version).manifestDigest !== manifest.manifestDigest) return Response.json({ code: "23505", message: "Synthetic version conflict" }, { status: 409 });
      return Response.json({ replayed: true });
    }
    stored.set(manifest.version, manifest);
    return Response.json({ replayed: false });
  };
  vi.stubGlobal("fetch", (input, init) => network(new Request(input, init)));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function route() { return importTestModule("src/app/api/team/platform-releases/v1/releases/route.ts", { "server-only": {} }); }
function request(manifest, { body = JSON.stringify(manifest), headers = {} } = {}) {
  return new NextRequest("https://application.example.test/api/team/platform-releases/v1/releases", {
    method: "POST", headers: { authorization: "Bearer synthetic-ingest", "content-type": "application/json", "idempotency-key": `platform-release:${manifest.manifestDigest}`, ...headers }, body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}
function heldRequest(manifest, headers = {}) {
  let entered, release;
  const reading = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const body = new ReadableStream({ async pull(controller) {
    entered(); await held;
    controller.enqueue(new TextEncoder().encode(JSON.stringify(manifest))); controller.close();
  } }, { highWaterMark: 0 });
  return { incoming: request(manifest, { body, headers }), reading, release };
}

test("secret rotation while the actual route waits for its body cannot reuse technical admission", async () => {
  const manifest = platformReleaseFixture();
  const { incoming, reading, release } = heldRequest(manifest);
  const { POST } = await route();
  const pending = POST(incoming);
  await reading;
  vi.stubEnv("FOUNDEROPS_PLATFORM_RELEASE_TOKEN", "rotated-ingest"); release();
  const response = await pending;
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ ok: false, error: "Ungültige Zugangsdaten." });
  expect(mutations).toHaveLength(0);
});

test.each(["url", "key", "disabled-secret"])("late %s configuration cannot switch the admitted persistence target", async change => {
  const { incoming, reading, release } = heldRequest(platformReleaseFixture()), { POST } = await route();
  const pending = POST(incoming); await reading;
  vi.stubEnv(change === "url" ? "NEXT_PUBLIC_SUPABASE_URL" : change === "key" ? "SUPABASE_SERVICE_ROLE_KEY" : "FOUNDEROPS_PLATFORM_RELEASE_TOKEN", change === "disabled-secret" ? "" : change === "url" ? "https://other-storage.example.test" : "new-key");
  release();
  expect((await pending).status).toBe(503); expect(mutations).toHaveLength(0);
});

test.each([true, false])("the idempotency key remains the originally admitted header while reading a body (initially valid: %s)", async valid => {
  const manifest = platformReleaseFixture(), correct = `platform-release:${manifest.manifestDigest}`;
  const { incoming, reading, release } = heldRequest(manifest, { "idempotency-key": valid ? correct : "platform-release:wrong" }), { POST } = await route();
  const pending = POST(incoming); await reading;
  incoming.headers.set("idempotency-key", valid ? "platform-release:changed" : correct); release();
  expect((await pending).status).toBe(valid ? 201 : 422);
  expect(mutations).toHaveLength(valid ? 1 : 0);
});

test("a mutated request URL after body acquisition cannot change the response resource target", async () => {
  const { incoming, reading, release } = heldRequest(platformReleaseFixture()), { POST } = await route();
  const pending = POST(incoming); await reading;
  incoming.nextUrl.host = "changed.example.test"; release();
  expect(await (await pending).json()).toMatchObject({ release: { url: "https://application.example.test/team/platform-releases/v1.2.3" } });
});

test("first ingest and an identical actual-route replay retain the fixed persisted manifest and result", async () => {
  const manifest = platformReleaseFixture(), { POST } = await route();
  const first = await POST(request(manifest)), replay = await POST(request(manifest));
  expect(first.status).toBe(201); expect(replay.status).toBe(200);
  expect(await first.json()).toEqual({ ok: true, replayed: false, release: { url: "https://application.example.test/team/platform-releases/v1.2.3" } });
  expect(await replay.json()).toMatchObject({ ok: true, replayed: true });
  expect(stored.size).toBe(1); expect(stored.get(manifest.version)).toEqual(manifest);
  expect(mutations).toHaveLength(2);
  expect(first.headers.get("cache-control")).toBe("no-store");
});

test("a valid changed manifest for the same version reaches the existing database conflict contract", async () => {
  const manifest = platformReleaseFixture(), { POST } = await route();
  expect((await POST(request(manifest))).status).toBe(201);
  const { canonicalPlatformReleaseManifest } = await importTestModule("src/features/platform-releases/model/platform-release-manifest.ts");
  const changed = { ...manifest, summary: "Ein anderer gültiger Inhalt." };
  changed.manifestDigest = createHash("sha256").update(canonicalPlatformReleaseManifest(changed)).digest("hex");
  const conflict = await POST(request(changed));
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ ok: false, error: "Diese Version existiert bereits mit einem anderen Digest." });
  expect(stored.get(manifest.version)).toEqual(manifest);
});

test.each(["missing", "wrong", "other-scheme"])("%s technical credentials cannot read a body or persist a release", async credential => {
  const manifest = platformReleaseFixture(), { POST } = await route();
  const pull = vi.fn(controller => controller.close());
  const response = await POST(request(manifest, { body: new ReadableStream({ pull }, { highWaterMark: 0 }), headers: { authorization: credential === "missing" ? "" : credential === "wrong" ? "Bearer wrong" : "bearer synthetic-ingest" } }));
  expect(response.status).toBe(401); expect(mutations).toHaveLength(0);
  expect(pull).not.toHaveBeenCalled();
});

test.each(["token", "database"])("missing %s configuration retains the existing unavailable response", async missing => {
  if (missing === "token") vi.stubEnv("FOUNDEROPS_PLATFORM_RELEASE_TOKEN", "");
  else { vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", ""); vi.stubEnv("SUPABASE_SECRET_KEY", ""); }
  const { POST } = await route(), response = await POST(request(platformReleaseFixture()));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, error: missing === "token" ? "Platform-Release-Ingest ist nicht konfiguriert." : "Platform-Release-Ingest ist nicht verfügbar." });
  expect(mutations).toHaveLength(0);
});

test.each(["content", "json", "empty", "digest", "idempotency"])("invalid %s cannot reuse an otherwise valid technical admission", async invalid => {
  const manifest = platformReleaseFixture();
  if (invalid === "digest") manifest.summary = "Changed unsigned content";
  const options = invalid === "content" ? { headers: { "content-type": "text/plain" } } : invalid === "json" ? { body: "{" }
    : invalid === "empty" ? { body: "" } : invalid === "idempotency" ? { headers: { "idempotency-key": "platform-release:wrong" } } : {};
  const { POST } = await route(), response = await POST(request(manifest, options));
  expect(response.status).toBe({ content: 415, json: 400, empty: 413, digest: 422, idempotency: 422 }[invalid]);
  expect(mutations).toHaveLength(0);
});

test("lost storage success is not automatically replayed and an explicit identical retry returns the persisted result", async () => {
  const manifest = platformReleaseFixture(), previous = network;
  let lost = false;
  network = async request => { const result = await previous(request); if (!lost) { lost = true; throw Error("synthetic-ingest response lost"); } return result; };
  const { POST } = await route();
  const first = await POST(request(manifest));
  expect(first.status).toBe(500); expect(mutations).toHaveLength(1); expect(stored.size).toBe(1);
  expect(JSON.stringify(await first.json())).not.toContain("synthetic-ingest");
  const retry = await POST(request(manifest));
  expect(retry.status).toBe(200); expect(await retry.json()).toMatchObject({ replayed: true });
  expect(mutations).toHaveLength(2); expect(stored.size).toBe(1);
});

test("the public action exposes only digest-bound persistence and does not inherit a human credential", async () => {
  const manifest = platformReleaseFixture(), original = request(manifest);
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "release-ingest-request", request: original }, action: "platform-release.ingest" };
  const permission = await authorizeCredentialAction(input);
  expect(Object.keys(permission.ingest)).toEqual(["persist"]);
  expect(JSON.stringify(permission)).not.toMatch(/synthetic|profile|client|token/);
  const changed = { ...manifest, manifestDigest: "a".repeat(64) };
  original.headers.set("idempotency-key", `platform-release:${changed.manifestDigest}`);
  expect(await permission.ingest.persist(changed)).toMatchObject({ ok: false, status: 422 });
  const override = vi.fn();
  expect(await permission.ingest.persist(manifest, { rpc: "other", fetch: override })).toEqual({ ok: true, replayed: false });
  expect(override).not.toHaveBeenCalled();
  expect(await authorizeCredentialAction({ credential: { kind: "session-request", request: original }, action: "platform-release.ingest" })).toMatchObject({ ok: false, status: 401 });
});
