import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

async function countRead(respond) {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  let revision = "notification-1";
  let dispatches = 0;
  let lifecycleReads = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    if (pathname === "/rest/v1/rpc/notification_publication_context") {
      return Response.json({ profile_id: "synthetic-profile", platform_role: "viewer", source_revision: revision });
    }
    if (pathname === "/rest/v1/rpc/notification_count_fast_path") {
      dispatches++;
      return respond({
        request,
        revision,
        changeRevision(next) { revision = next; },
        ready(unreadCount, options = {}) {
          return Response.json({
            status: "ready", unread_count: unreadCount, source_revision: revision,
            observed_at: new Date().toISOString(), valid_until: new Date(Date.now() + 60_000).toISOString(),
            ...options,
          });
        },
      });
    }
    if (pathname === "/rest/v1/notification_events") {
      lifecycleReads++;
      if (request.method === "HEAD") return new Response(null, { headers: { "content-range": "*/7" } });
      return Response.json([]);
    }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: read => read } });
  const response = await GET(protocol.request("/api/notifications-data?area=count"));
  return { status: response.status, payload: await response.json(), dispatches, lifecycleReads };
}

test("returns a complete independently available count without running the legacy event scan", async () => {
  const result = await countRead(({ ready }) => ready(1041));
  expect(result).toMatchObject({ status: 200, payload: { unreadCount: 1041, sourceRevision: "notification-1" }, dispatches: 1, lifecycleReads: 0 });
});

test("uses the established lifecycle path only when the snapshot requires reconciliation", async () => {
  const result = await countRead(({ revision }) => Response.json({ status: "needs_reconcile", source_revision: revision }));
  expect(result).toMatchObject({ status: 200, payload: { unreadCount: 7 }, dispatches: 1, lifecycleReads: 2 });
});

test("retries a count superseded before publication without releasing its number", async () => {
  const result = await countRead(({ revision, ready, changeRevision }) => {
    if (revision !== "notification-1") return ready(18);
    const old = ready(1041);
    changeRevision("notification-2");
    return old;
  });
  expect(result).toMatchObject({ status: 200, payload: { unreadCount: 18, sourceRevision: "notification-2" }, dispatches: 2, lifecycleReads: 0 });
});

test.each([["unauthorized", 403], ["failed", 503], ["expired", 503], ["malformed", 503]])("does not present a count or fall back for a %s snapshot", async (outcome, status) => {
  const result = await countRead(({ ready }) => {
    if (outcome === "unauthorized") return Response.json({ message: "Access denied" }, { status: 403 });
    if (outcome === "failed") return Response.json({ status: "unavailable" });
    if (outcome === "malformed") return ready(null);
    return ready(0, { observed_at: new Date(Date.now() - 120_000).toISOString(), valid_until: new Date(Date.now() - 60_000).toISOString() });
  });
  expect(result).toMatchObject({ status, dispatches: 1, lifecycleReads: 0 });
  expect(result.payload).not.toHaveProperty("unreadCount");
});
