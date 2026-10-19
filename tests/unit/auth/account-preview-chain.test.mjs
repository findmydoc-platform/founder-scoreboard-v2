import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

let protocol;
let storage;
beforeEach(() => {
  vi.resetModules();
  protocol = administratorProtocol();
  storage = [];
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname.startsWith("/storage/v1/")) {
      storage.push({ path: url.pathname, method: request.method, credential: request.headers.get("authorization"), type: request.headers.get("content-type"), bytes: [...new Uint8Array(await request.arrayBuffer())] });
      if (protocol.state.storageError) return Response.json({ error: "Synthetic storage failure", message: "Synthetic storage failure", statusCode: "404" }, { status: 404 });
      return request.method === "GET" ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }) : Response.json({ Key: url.pathname.slice("/storage/v1/object/".length) });
    }
    return authFetch(request);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("owns the preview bucket and generated PNG path and snapshots bytes before live authorization awaits", async () => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request("/api/tools/preview-image", "POST", {}) }, action: "account.preview.write" });
  expect(permission.ok).toBe(true);
  const bytes = new Uint8Array([1, 2, 3]);
  const pending = permission.account.uploadPreview({ bytes, contentType: "image/png" });
  bytes[0] = 9;
  const result = await pending;
  expect(result.error).toBeNull();
  expect(result.path).toMatch(/^quicklinks\/\d{4}-\d{2}-\d{2}\/\d+-[a-f0-9-]+\.png$/);
  expect(storage).toEqual([{ path: `/storage/v1/object/fmd-tool-previews/${result.path}`, method: "POST", credential: "Bearer synthetic-service", type: "image/png", bytes: [1, 2, 3] }]);
});

it("binds the preview read to a validated path and the existing server cookie session", async () => {
  const jar = protocol.cookieJar();
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {}, "next/headers": { cookies: async () => jar } });
  const input = { credential: { kind: "server-cookies" }, action: "account.preview.read", path: "quicklinks/2026-10-17/123-preview.png" };
  const pending = authorizeCredentialAction(input);
  input.path = "private/foreign.png";
  const permission = await pending;
  expect(permission.ok).toBe(true);
  const result = await permission.account.readPreview();
  expect(result.error).toBeNull();
  expect([...new Uint8Array(await result.data.arrayBuffer())]).toEqual([1, 2, 3]);
  expect(storage).toEqual([{ path: "/storage/v1/object/fmd-tool-previews/quicklinks/2026-10-17/123-preview.png", method: "GET", credential: "Bearer synthetic-service", type: null, bytes: [] }]);
});


it("serves a PNG through the actual cookie-only GET with private cache and content sniffing protection", async () => {
  const { GET } = await importTestModule("src/app/api/tools/preview-image/route.ts", { "server-only": {}, "next/headers": { cookies: async () => protocol.cookieJar() } });
  const response = await GET(protocol.request("/api/tools/preview-image?path=quicklinks/2026-10-17/123-preview.png"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-type")).toBe("image/png");
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  const invalid = await GET(protocol.request("/api/tools/preview-image?path=private/foreign.png"));
  expect(invalid.status).toBe(400);
  expect(storage).toHaveLength(1);
});

it("rejects the actual GET without a cookie even when its request has a valid Bearer credential", async () => {
  const { GET } = await importTestModule("src/app/api/tools/preview-image/route.ts", { "server-only": {}, "next/headers": { cookies: async () => ({ getAll: () => [], set() {} }) } });
  const response = await GET(protocol.request("/api/tools/preview-image?path=quicklinks/2026-10-17/123-preview.png"));
  expect(response.status).toBe(401);
  expect(storage).toHaveLength(0);
});


it("keeps the actual upload PNG response and denies unsupported file types and viewer mutation", async () => {
  const { POST } = await importTestModule("src/app/api/tools/preview-image/route.ts", { "server-only": {} });
  function upload(type) {
    const form = new FormData(); form.set("file", new File([new Uint8Array([1, 2, 3])], "preview.png", { type }));
    return new NextRequest("https://app.example.test/api/tools/preview-image", { method: "POST", headers: { authorization: protocol.request().headers.get("authorization") }, body: form });
  }
  const response = await POST(upload("image/png"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ ok: true, source: "manual" });
  expect(body.imageUrl).toMatch(/^\/api\/tools\/preview-image\?path=quicklinks%2F/);
  expect((await POST(upload("text/html"))).status).toBe(415);
  protocol.state.role = "viewer";
  expect((await POST(upload("image/png"))).status).toBe(403);
  expect(storage).toHaveLength(1);
});


it("keeps failed preview retrieval opaque and denies an unmapped cookie before storage", async () => {
  const { GET } = await importTestModule("src/app/api/tools/preview-image/route.ts", { "server-only": {}, "next/headers": { cookies: async () => protocol.cookieJar() } });
  protocol.state.storageError = true;
  const response = await GET(protocol.request("/api/tools/preview-image?path=quicklinks/2026-10-17/123-preview.png"));
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Bild nicht verfügbar." });
  protocol.state.profile = false;
  expect((await GET(protocol.request("/api/tools/preview-image?path=quicklinks/2026-10-17/123-preview.png"))).status).toBe(403);
  expect(storage).toHaveLength(1);
});
