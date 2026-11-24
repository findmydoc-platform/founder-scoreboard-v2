import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

test("the authorized preview remains usable when the separate unread count is unavailable", async () => {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  let countAttempts = 0, broadPlanningReads = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/notification_publication_context") return Response.json({ profile_id: "synthetic-profile", platform_role: "viewer", source_revision: "notification-1", observed_at: new Date().toISOString(), valid_until: new Date(Date.now() + 60000).toISOString() });
    if (url.pathname === "/rest/v1/rpc/notification_content_fast_path") return Response.json({ status: "needs_reconcile", source_revision: "notification-1" });
    if (url.pathname === "/rest/v1/notification_events") {
      if (request.method === "HEAD") { countAttempts++; return Response.json({ message: "count unavailable" }, { status: 503 }); }
      if (url.searchParams.get("order")?.startsWith("id.asc")) return Response.json([]);
      return Response.json([{ id: 1, type: "task.mention", actor_profile_id: "synthetic-profile", recipient_profile_id: "synthetic-profile", entity_type: "task", entity_id: "off-page-task", title: "A useful notification", body: "", status: "pending", seen_at: null, created_at: "2026-11-19T12:00:00Z" }]);
    }
    if (url.pathname === "/rest/v1/active_tasks") { broadPlanningReads++; return Response.json([]); }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: read => read } });
  const response = await GET(protocol.request("/api/notifications-data?area=preview"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ items: [{ id: 1, entityId: "off-page-task" }], readActor: { profileId: "synthetic-profile", platformRole: "viewer" }, sourceRevision: "notification-1" });
  expect(countAttempts).toBe(0);
  expect(broadPlanningReads).toBe(0);
});

test("a continuously changing notification source cannot publish an apparently current preview", async () => {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  let revision = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/notification_publication_context") return Response.json({ profile_id: "synthetic-profile", platform_role: "viewer", source_revision: String(++revision) });
    if (url.pathname === "/rest/v1/rpc/notification_content_fast_path") return Response.json({ status: "needs_reconcile", source_revision: String(revision) });
    if (url.pathname === "/rest/v1/notification_events") return Response.json([]);
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: read => read } });
  const response = await GET(protocol.request("/api/notifications-data?area=preview"));
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty("items");
});

test("a source change during preview selection discards the old page and publishes only a current retry", async () => {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  let revision = "source-1", selections = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/notification_publication_context") return Response.json({ profile_id: "synthetic-profile", platform_role: "viewer", source_revision: revision });
    if (url.pathname === "/rest/v1/rpc/notification_content_fast_path") return Response.json({ status: "needs_reconcile", source_revision: revision });
    if (url.pathname === "/rest/v1/notification_events") {
      if (url.searchParams.get("order")?.startsWith("id.asc")) return Response.json([]);
      selections++;
      if (selections === 1) { revision = "source-2"; return Response.json([{ id: 1, type: "task.mention", actor_profile_id: "synthetic-profile", recipient_profile_id: "synthetic-profile", entity_type: "task", entity_id: "target", title: "Old", status: "pending", seen_at: null, created_at: "2026-11-19T12:00:00Z" }]); }
      return Response.json([{ id: 2, type: "task.mention", actor_profile_id: "synthetic-profile", recipient_profile_id: "synthetic-profile", entity_type: "task", entity_id: "target", title: "New", status: "pending", seen_at: null, created_at: "2026-11-19T12:01:00Z" }]);
    }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: read => read } });
  const response = await GET(protocol.request("/api/notifications-data?area=preview"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.sourceRevision).toBe("source-2");
  expect(body.items.map(item => item.title)).toEqual(["New"]);
  expect(selections).toBe(2);
});

test.each([["*/1041", 200, 1041], [null, 503, null]])("unread count uses complete authorized count metadata: %s", async (range, expectedStatus, expectedCount) => {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  let previewReads = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/notification_publication_context") return Response.json({ profile_id: "synthetic-profile", platform_role: "viewer", source_revision: "source-1" });
    if (url.pathname === "/rest/v1/rpc/notification_count_fast_path") return Response.json({ status: "needs_reconcile", source_revision: "source-1" });
    if (url.pathname === "/rest/v1/rpc/notification_content_fast_path") return Response.json({ status: "needs_reconcile", source_revision: "source-1" });
    if (url.pathname === "/rest/v1/notification_events") {
      if (request.method === "HEAD") return new Response(null, { headers: range ? { "content-range": range } : {} });
      if (url.searchParams.get("order")?.startsWith("id.asc")) return Response.json([]);
      previewReads++; return Response.json([], { status: 503 });
    }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: read => read } });
  const response = await GET(protocol.request("/api/notifications-data?area=count"));
  expect(response.status).toBe(expectedStatus);
  const body = await response.json();
  if (expectedCount === null) expect(body).not.toHaveProperty("unreadCount");
  else expect(body).toMatchObject({ unreadCount: expectedCount, readActor: { profileId: "synthetic-profile", platformRole: "viewer" }, sourceRevision: "source-1" });
  expect(previewReads).toBe(0);
});

test("an actor rebound before publication cannot expose preview content", async () => {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  let publications = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/notification_publication_context") return Response.json({ profile_id: ++publications >= 4 ? "other-profile" : "synthetic-profile", platform_role: "viewer", source_revision: "source-1" });
    if (url.pathname === "/rest/v1/rpc/notification_content_fast_path") return Response.json({ status: "needs_reconcile", source_revision: "source-1" });
    if (url.pathname === "/rest/v1/notification_events") {
      if (url.searchParams.get("order")?.startsWith("id.asc")) return Response.json([]);
      return Response.json([{ id: 1, type: "task.mention", actor_profile_id: "synthetic-profile", recipient_profile_id: "synthetic-profile", entity_type: "task", entity_id: "target", title: "Protected", status: "pending", seen_at: null, created_at: "2026-11-19T12:00:00Z" }]);
    }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: read => read } });
  const response = await GET(protocol.request("/api/notifications-data?area=preview"));
  expect(response.status).toBe(403);
  expect(await response.json()).not.toHaveProperty("items");
});

test("a denied preview read clears the active scope instead of reporting a temporary failure", async () => {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/notification_publication_context") return Response.json({ profile_id: "synthetic-profile", platform_role: "viewer", source_revision: "source-1" });
    if (url.pathname === "/rest/v1/rpc/notification_content_fast_path") return Response.json({ status: "needs_reconcile", source_revision: "source-1" });
    if (url.pathname === "/rest/v1/notification_events") {
      if (url.searchParams.get("order")?.startsWith("id.asc")) return Response.json([]);
      return Response.json({ code: "42501", message: "denied" }, { status: 403 });
    }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: read => read } });
  const response = await GET(protocol.request("/api/notifications-data?area=preview"));
  expect(response.status).toBe(403);
  expect(await response.json()).not.toHaveProperty("items");
});

test("the original session deadline cannot expire before a preview is published", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const protocol = administratorProtocol({ role: "viewer" });
  const request = protocol.request("/api/notifications-data?area=preview");
  const token = request.headers.get("authorization").slice(7);
  const deadline = JSON.parse(Buffer.from(token.split(".")[1], "base64url")).exp * 1000;
  const authFetch = globalThis.fetch;
  let publications = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const current = new Request(input, init), url = new URL(current.url);
    if (url.pathname === "/rest/v1/rpc/notification_publication_context") {
      if (++publications === 4) vi.setSystemTime(deadline);
      return Response.json({ profile_id: "synthetic-profile", platform_role: "viewer", source_revision: "source-1" });
    }
    if (url.pathname === "/rest/v1/rpc/notification_content_fast_path") return Response.json({ status: "needs_reconcile", source_revision: "source-1" });
    if (url.pathname === "/rest/v1/notification_events") return Response.json([]);
    return authFetch(current);
  });
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: read => read } });
  const response = await GET(request);
  expect(response.status).toBe(403);
  expect(await response.json()).not.toHaveProperty("items");
});

test("an inbox continuation rejects a changed source instead of mixing pages", async () => {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  let revision = "source-1";
  const rows = Array.from({ length: 41 }, (_, index) => ({ id: 100 - index, type: "task.mention", actor_profile_id: "synthetic-profile", recipient_profile_id: "synthetic-profile", entity_type: "task", entity_id: `task-${index}`, title: `Event ${index}`, status: "pending", seen_at: null, created_at: `2026-11-19T12:00:${String(59 - index).padStart(2, "0")}.123456Z` }));
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/notification_publication_context") return Response.json({ profile_id: "synthetic-profile", platform_role: "viewer", source_revision: revision });
    if (url.pathname === "/rest/v1/rpc/notification_content_fast_path") return Response.json({ status: "needs_reconcile", source_revision: revision });
    if (url.pathname === "/rest/v1/notification_events") {
      if (url.searchParams.get("order")?.startsWith("id.asc")) return Response.json([]);
      return Response.json(rows);
    }
    if (url.pathname === "/rest/v1/active_tasks") return Response.json([]);
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: read => read } });
  const first = await GET(protocol.request("/api/notifications-data?area=inbox"));
  expect(first.status).toBe(200);
  const body = await first.json();
  expect(body.events).toHaveLength(40);
  expect(body).toMatchObject({ coverage: "partial", referenceCoverage: "partial", sourceRevision: "source-1" });
  expect(typeof body.continuation).toBe("string");
  revision = "source-2";
  const second = await GET(protocol.request(`/api/notifications-data?area=inbox&continuation=${encodeURIComponent(body.continuation)}`));
  expect(second.status).toBe(409);
  expect(await second.json()).not.toHaveProperty("events");
});

test("concurrent preview and inbox share only in-flight reconciliation while retaining independent results", async () => {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  let reconciliations = 0, publications = 0;
  const order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/notification_publication_context") {
      order.push("publication");
      if (++publications === 4) setTimeout(release, 25);
      return Response.json({ profile_id: "synthetic-profile", platform_role: "viewer", source_revision: "source-1" });
    }
    if (url.pathname === "/rest/v1/active_tasks") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/notification_content_fast_path") return Response.json({ status: "needs_reconcile", source_revision: "source-1" });
    if (url.pathname === "/rest/v1/notification_events") {
      if (url.searchParams.get("order")?.startsWith("id.asc")) { order.push("reconciliation"); reconciliations++; await gate; return Response.json([]); }
      return Response.json([{ id: 1, type: "task.mention", actor_profile_id: "synthetic-profile", recipient_profile_id: "synthetic-profile", entity_type: "task", entity_id: "target", title: "Useful", status: "pending", seen_at: null, created_at: "2026-11-19T12:00:00Z" }]);
    }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: read => read } });
  const [preview, inbox] = await Promise.all([GET(protocol.request("/api/notifications-data?area=preview")), GET(protocol.request("/api/notifications-data?area=inbox"))]);
  expect(preview.status).toBe(200);
  expect((await preview.json()).items.map(item => item.title)).toEqual(["Useful"]);
  expect(inbox.status).toBe(200);
  expect((await inbox.json()).events.map(event => event.title)).toEqual(["Useful"]);
  expect(reconciliations).toBe(1);
  expect(order.slice(0, 5)).toEqual(["publication", "publication", "publication", "publication", "reconciliation"]);
});

test("a shared read failure triggers independent reconciliation retries", async () => {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  let reconciliations = 0, publications = 0;
  const order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/notification_publication_context") {
      order.push("publication");
      if (++publications === 4) setTimeout(release, 25);
      return Response.json({ profile_id: "synthetic-profile", platform_role: "viewer", source_revision: "source-1" });
    }
    if (url.pathname === "/rest/v1/active_tasks") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/notification_content_fast_path") return Response.json({ status: "needs_reconcile", source_revision: "source-1" });
    if (url.pathname === "/rest/v1/notification_events") {
      if (url.searchParams.get("order")?.startsWith("id.asc")) { order.push("reconciliation"); reconciliations++; await gate; if (reconciliations === 1) return Response.json({ message: "unavailable" }, { status: 503 }); return Response.json([]); }
      return Response.json([{ id: 1, type: "task.mention", actor_profile_id: "synthetic-profile", recipient_profile_id: "synthetic-profile", entity_type: "task", entity_id: "target", title: "Useful", status: "pending", seen_at: null, created_at: "2026-11-19T12:00:00Z" }]);
    }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: read => read } });
  const [preview, inbox] = await Promise.all([GET(protocol.request("/api/notifications-data?area=preview")), GET(protocol.request("/api/notifications-data?area=inbox"))]);
  expect(preview.status).toBe(200);
  expect((await preview.json()).items.map(item => item.title)).toEqual(["Useful"]);
  expect(inbox.status).toBe(200);
  expect((await inbox.json()).events.map(event => event.title)).toEqual(["Useful"]);
  expect(reconciliations).toBe(3);
  expect(order.slice(0, 5)).toEqual(["publication", "publication", "publication", "publication", "reconciliation"]);
});

test.each([
  { profile: "synthetic-profile", responseStatus: 200 },
  { profile: "other-profile", responseStatus: 403 },
])("an exact revision observation is actor-bound and never reads content ($responseStatus)", async ({ profile, responseStatus }) => {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  let revisionCalls = 0, contentCalls = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/notification_publication_context") {
      revisionCalls++;
      return Response.json({ profile_id: profile, platform_role: "viewer", source_revision: "revision-2" });
    }
    if (url.pathname === "/rest/v1/notification_events") contentCalls++;
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: read => read } });
  const response = await GET(protocol.request("/api/notifications-data?area=revision"));
  expect(response.status).toBe(responseStatus);
  expect(revisionCalls).toBe(1);
  expect(contentCalls).toBe(0);
  if (response.ok) {
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ sourceRevision: "revision-2", readActor: { profileId: "synthetic-profile", platformRole: "viewer" }, readAuthority: { userId: "synthetic-user" } });
  } else expect(await response.json()).not.toHaveProperty("sourceRevision");
});
