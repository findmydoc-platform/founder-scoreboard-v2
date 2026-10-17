import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { platformReleaseSeed } from "@/features/platform-releases/model/platform-release-seed";

const release = platformReleaseSeed[0];
let protocol;
let resources;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "test");
  protocol = administratorProtocol({ role: "viewer" });
  resources = [];
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/workspace_access_context" && protocol.state.rebound) return Response.json({ mode: "legacy", userId: "synthetic-user", profileId: "other-profile" });
    if (url.pathname === "/rest/v1/rpc/current_authenticated_profile" && protocol.state.rebound) return Response.json({ id: "other-profile", name: "Other Viewer", platform_role: "viewer" });
    if (url.pathname === "/rest/v1/rpc/administrator_access_snapshot" && protocol.state.rebindAfterShell) {
      const response = await authFetch(request); protocol.state.rebound = true; return response;
    }
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.startsWith("/rest/v1/rpc/")) {
      const table = url.pathname.split("/").at(-1);
      resources.push({ table, method: request.method, query: url.searchParams, credential: request.headers.get("authorization"), body: request.method === "GET" ? null : await request.json() });
      if (protocol.state.queryFailure === table) return Response.json({ code: "42P01", message: "Synthetic query failure" }, { status: 400 });
      if (table === "platform_releases") return Response.json([{ version: release.version, summary: release.summary, published_at: release.publishedAt, manifest_digest: release.manifestDigest, manifest: release.manifest }]);
      if (table === "notification_events") return request.method === "PATCH" ? new Response(null, { status: 204 }) : Response.json(url.searchParams.get("entity_type") === "eq.platform_release" ? [{ id: 17, entity_id: release.version, seen_at: null }] : []);
      if (["active_tasks", "task_links", "fmd_tools", "founder_events"].includes(table)) return Response.json([]);
      throw new Error("Unexpected synthetic release resource");
    }
    return authFetch(request);
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("admits an existing viewer to bounded human release reads with the original recipient and link filters", async () => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request("/api/team/platform-releases/v1/releases") }, action: "releases.read" });
  expect(permission.ok).toBe(true);
  const result = await permission.account.readReleases();
  expect(result.available).toBe(true);
  expect(result.releases.map(item => item.version)).toEqual([release.version]);
  const releases = resources.find(resource => resource.table === "platform_releases");
  expect(releases.query.get("limit")).toBe("200");
  expect(releases.query.get("order")).toBe("published_at.desc");
  expect(resources.find(resource => resource.table === "task_links").query.get("type")).toBe("eq.github_pull_request");
  const notifications = resources.find(resource => resource.table === "notification_events");
  expect(notifications.query.get("recipient_profile_id")).toBe("eq.synthetic-profile");
  expect(notifications.query.get("entity_type")).toBe("eq.platform_release");
  expect(resources.every(resource => resource.credential === "Bearer synthetic-service")).toBe(true);
});


it("keeps the actual GET cache and safe empty query-failure response contracts", async () => {
  const { GET } = await importTestModule("src/app/api/team/platform-releases/v1/releases/route.ts", { "server-only": {} });
  const response = await GET(protocol.request("/api/team/platform-releases/v1/releases"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).releases[0].version).toBe(release.version);
  protocol.state.queryFailure = "platform_releases";
  const unavailableTable = await GET(protocol.request("/api/team/platform-releases/v1/releases"));
  expect(unavailableTable.status).toBe(200);
  expect(await unavailableTable.json()).toEqual({ ok: true, releases: [] });
  protocol.state.profile = false;
  const previous = resources.length;
  const denied = await GET(protocol.request("/api/team/platform-releases/v1/releases"));
  expect(denied.status).toBe(403);
  expect(denied.headers.get("cache-control")).toBe("no-store");
  expect(resources).toHaveLength(previous);
});


it("binds the seen mutation to the authenticated recipient and version captured before verification", async () => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request("/api/team/platform-releases/v1/releases/v1.2.3/seen", "POST", {}) }, action: "releases.seen", version: "v1.2.3" };
  const pending = authorizeCredentialAction(input);
  input.version = "v9.9.9";
  const permission = await pending;
  expect(permission.ok).toBe(true);
  expect((await permission.account.markReleaseSeen()).error).toBeNull();
  const update = resources.find(resource => resource.method === "PATCH");
  expect(update.table).toBe("notification_events");
  expect(Object.keys(update.body)).toEqual(["seen_at"]);
  expect(update.query.get("recipient_profile_id")).toBe("eq.synthetic-profile");
  expect(update.query.get("entity_type")).toBe("eq.platform_release");
  expect(update.query.get("entity_id")).toBe("eq.v1.2.3");
  expect(update.query.get("seen_at")).toBe("is.null");
});


it.each(["src/app/team/platform-releases/page.tsx", "src/app/team/platform-releases/[version]/page.tsx"])("does not mix an earlier release SSR shell actor with rebound data: %s", async path => {
  protocol.state.rebindAfterShell = true;
  const pageModule = await importTestModule(path, {
    "server-only": {}, "next/headers": { cookies: async () => protocol.cookieJar() },
    "next/cache": { unstable_cache: load => load },
    "next/navigation": { notFound: () => { throw new Error("Synthetic not found"); }, redirect: () => {} },
    "@/features/planning/PlanningApp": { PlanningApp: () => null },
    "@/features/platform-releases/templates/platform-releases-shell": { PlatformReleasesShell: () => null },
    "@/features/platform-releases/organisms/platform-release-archive": { PlatformReleaseArchive: () => null },
    "@/features/platform-releases/organisms/platform-release-detail": { PlatformReleaseDetail: () => null },
  });
  try { await pageModule.default({ params: Promise.resolve({ version: release.version }), searchParams: Promise.resolve({}) }); }
  catch (error) { expect(error.message).toBe("Synthetic not found"); }
  expect(resources).toHaveLength(0);
});


it("keeps release headers behind live admission on cache hits and the original token deadline after awaits", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const cache = new Map();
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", {
    "server-only": {}, "next/cache": { unstable_cache: (load, keys) => async () => {
      const key = JSON.stringify(keys);
      if (!cache.has(key)) cache.set(key, await load());
      else if (protocol.state.expireOnCacheHit) vi.setSystemTime(protocol.state.expireOnCacheHit);
      return cache.get(key);
    } },
  });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "releases.read" });
  expect((await permission.account.loadReleaseHeader()).available).toBe(true);
  expect(cache.size).toBe(2);
  expect((await permission.account.loadReleaseHeader()).available).toBe(true);
  expect(resources.filter(resource => resource.table === "fmd_tools")).toHaveLength(1);
  const token = protocol.request().headers.get("authorization").slice(7);
  protocol.state.expireOnCacheHit = JSON.parse(Buffer.from(token.split(".")[1], "base64url")).exp * 1000;
  expect((await permission.account.loadReleaseHeader()).available).toBe(false);
});


it("preserves real seen-route success, invalid-version, denied-session and failed-write responses", async () => {
  const { POST } = await importTestModule("src/app/api/team/platform-releases/v1/releases/[version]/seen/route.ts", { "server-only": {} });
  const invoke = version => POST(protocol.request(`/api/team/platform-releases/v1/releases/${version}/seen`, "POST", {}), { params: Promise.resolve({ version }) });
  expect((await invoke("v1.2.3")).status).toBe(200);
  expect(resources.filter(resource => resource.method === "PATCH")).toHaveLength(1);
  expect((await invoke("foreign")).status).toBe(400);
  expect(resources.filter(resource => resource.method === "PATCH")).toHaveLength(1);
  protocol.state.queryFailure = "notification_events";
  expect((await invoke("v1.2.3")).status).toBe(500);
  protocol.state.profile = false;
  const previous = resources.length;
  expect((await invoke("v1.2.3")).status).toBe(403);
  expect(resources).toHaveLength(previous);
});

it("keeps unavailable strict release dependencies separate from ordinary data query failures", async () => {
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]) vi.stubEnv(name, "");
  const { GET } = await importTestModule("src/app/api/team/platform-releases/v1/releases/route.ts", { "server-only": {} });
  const response = await GET(protocol.request("/api/team/platform-releases/v1/releases"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, error: "Workspace-Zugang konnte vorübergehend nicht geprüft werden.", code: "workspace_access_unavailable" });
  expect(resources).toHaveLength(0);
});
