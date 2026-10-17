import { vi as mockRuntime } from "vitest";
mockRuntime.mock("server-only", () => ({}));
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, afterEach, test, vi } from "vitest";
import { platformReleaseFixture as fixture } from "../../helpers/platform-release-fixture.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const contract = await importTestModule("src/features/platform-releases/model/platform-release-manifest.ts");
let storedManifest;
let replayed = false;
const route = await importTestModule("src/app/api/team/platform-releases/v1/releases/route.ts", { "server-only": {} });
beforeEach(() => {
  const origin = "https://ingest-storage.example.test";
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: origin, SUPABASE_URL: origin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_PUBLISHABLE_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", SUPABASE_SECRET_KEY: "synthetic-service" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== `${origin}/rest/v1/rpc/ingest_platform_release_v1` || request.method !== "POST") throw Error("Unscripted protocol");
    storedManifest = (await request.json()).p_manifest;
    return Response.json({ replayed });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  storedManifest = undefined;
  replayed = false;
});

function request(manifest, { body = JSON.stringify(manifest), headers = {} } = {}) {
  vi.stubEnv("FOUNDEROPS_PLATFORM_RELEASE_TOKEN", "test-ingest-token");
  return new NextRequest("https://example.com/api/team/platform-releases/v1/releases", {
    method: "POST",
    headers: { authorization: "Bearer test-ingest-token", "content-type": "application/json",
      "idempotency-key": `platform-release:${manifest.manifestDigest}`, ...headers },
    body,
  });
}

test("Ingest accepts a full multiline commit message with the release-runner digest unchanged", async () => {
  const manifest = fixture();
  assert.ok(manifest.components[0].commits[0].message.length > 1000);
  const response = await route.POST(request(manifest));
  assert.equal(response.status, 201);
  assert.deepEqual(storedManifest, manifest);
  assert.equal(createHash("sha256").update(contract.canonicalPlatformReleaseManifest(storedManifest)).digest("hex"), manifest.manifestDigest);
  assert.deepEqual(await response.json(), {
    ok: true, replayed: false, release: { url: "https://example.com/team/platform-releases/v1.2.3" },
  });
});

test.each([2, 3])("Manifest v%i accepts commit messages through the request-sized character ceiling", (schemaVersion) => {
  for (const length of [1000, 1001, 2_000_000]) {
    const manifest = fixture("x".repeat(length));
    if (schemaVersion === 2) {
      manifest.schemaVersion = 2;
      for (const change of manifest.changes) {
        delete change.componentKeys;
        delete change.commitShas;
        change.section = "public";
      }
    }
    const validation = contract.validatePlatformReleaseManifest(manifest);
    assert.equal(validation.ok, true);
    assert.equal(validation.manifest.components[0].commits[0].message, manifest.components[0].commits[0].message);
  }
});

test.each(["x".repeat(2_000_001), null, 123, {}])("Manifest rejects oversized or non-string commit messages %#", (message) => {
  assert.deepEqual(contract.validatePlatformReleaseManifest(fixture(message)), {
    ok: false, error: "Komponenten sind ungültig.",
  });
});

test("Ingest keeps the exact 2 MB UTF-8 body boundary for long commit messages", async () => {
  const manifest = fixture();
  const serialized = JSON.stringify(manifest);
  const atLimit = serialized + " ".repeat(2_000_000 - Buffer.byteLength(serialized, "utf8"));
  assert.equal((await route.POST(request(manifest, { body: atLimit }))).status, 201);
  assert.deepEqual(storedManifest, manifest);
  storedManifest = undefined;
  assert.equal((await route.POST(request(manifest, { body: atLimit + " " }))).status, 413);
  assert.equal(storedManifest, undefined);
});

test("Ingest rejects aggregate multibyte payloads even below the character ceiling", async () => {
  const manifest = fixture("ä".repeat(500_000));
  manifest.components[1].commits = [{ bump: "patch", message: "ö".repeat(500_000),
    sha: "b".repeat(40), url: `https://github.com/findmydoc-platform/clinic-dashboard/commit/${"b".repeat(40)}` }];
  const serialized = JSON.stringify(manifest);
  assert.ok(serialized.length < 2_000_000);
  assert.ok(Buffer.byteLength(serialized, "utf8") > 2_000_000);
  assert.equal(contract.validatePlatformReleaseManifest(manifest).ok, true);
  assert.equal((await route.POST(request(manifest))).status, 413);
  assert.equal(storedManifest, undefined);
});

test("Ingest rejects changed commit text with the original digest", async () => {
  const manifest = fixture();
  manifest.components[0].commits[0].message += "\nChanged evidence";
  const response = await route.POST(request(manifest));
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { ok: false, error: "Manifest-Digest stimmt nicht mit dem Inhalt überein." });
  assert.equal(storedManifest, undefined);
});

test("Ingest still requires the digest-bound idempotency key", async () => {
  const response = await route.POST(request(fixture(), { headers: { "idempotency-key": "platform-release:wrong" } }));
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { ok: false, error: "Idempotency-Key stimmt nicht mit dem Manifest-Digest überein." });
  assert.equal(storedManifest, undefined);
});

test.each(["", "Bearer wrong-token"])("Ingest rejects unauthenticated long-message submissions %#", async (authorization) => {
  assert.equal((await route.POST(request(fixture(), { headers: { authorization } }))).status, 401);
  assert.equal(storedManifest, undefined);
});

test("Ingest preserves successful replay responses for long messages", async () => {
  replayed = true;
  const manifest = fixture();
  const response = await route.POST(request(manifest));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).replayed, true);
  assert.deepEqual(storedManifest, manifest);
});

test.each([
  ["catalog", (manifest) => { manifest.components[0].repository = "other/repository"; }],
  ["source", (manifest) => { manifest.source = { kind: "github-release-import" }; }],
  ["reference", (manifest) => { manifest.changes[0].commitShas = ["c".repeat(40)]; }],
])("Long-message manifests still enforce %s validation", async (_boundary, change) => {
  const manifest = fixture();
  change(manifest);
  assert.equal((await route.POST(request(manifest))).status, 422);
  assert.equal(storedManifest, undefined);
});
