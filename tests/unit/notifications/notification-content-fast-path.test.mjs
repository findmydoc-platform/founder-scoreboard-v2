import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

const eventRow = id => ({
  id, type: "task.mention", actor_profile_id: "synthetic-profile",
  recipient_profile_id: "synthetic-profile", entity_type: "task", entity_id: `task-${id}`,
  title: `Notice ${id}`, body: "", status: "pending", seen_at: null, created_at: "2026-11-19T12:00:00Z",
});

async function contentRead(area, content) {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  let revision = "notification-1";
  const calls = { snapshot: 0, notificationReads: 0, count: 0, references: [] };
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/notification_publication_context") {
      return Response.json({ profile_id: "synthetic-profile", platform_role: "viewer", source_revision: revision });
    }
    if (url.pathname === "/rest/v1/rpc/notification_content_fast_path") {
      calls.snapshot++;
      return content({
        revision,
        changeRevision(next) { revision = next; },
        ready(rows) {
          return Response.json({ status: "ready", rows, source_revision: revision, observed_at: new Date().toISOString(), valid_until: new Date(Date.now() + 60_000).toISOString() });
        },
      });
    }
    if (url.pathname === "/rest/v1/rpc/notification_count_fast_path") { calls.count++; return Response.json({ status: "unavailable" }); }
    if (url.pathname === "/rest/v1/notification_events") {
      calls.notificationReads++;
      if (url.searchParams.get("order")?.startsWith("id.asc")) return Response.json([]);
      return Response.json([eventRow(5)]);
    }
    if (url.pathname === "/rest/v1/active_tasks") {
      calls.references.push(url.searchParams.get("id"));
      return Response.json([{ id: "task-41", title: "An authorized reference", task_type: "deliverable" }]);
    }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: read => read } });
  const response = await GET(protocol.request(`/api/notifications-data?area=${area}`));
  return { status: response.status, body: await response.json(), calls };
}

test("reveals the bounded preview through its own snapshot without count or additional event reads", async () => {
  const result = await contentRead("preview", ({ ready }) => ready([eventRow(41)]));
  expect(result).toMatchObject({ status: 200, body: { items: [{ id: 41 }], sourceRevision: "notification-1" },
    calls: { snapshot: 1, notificationReads: 0, count: 0, references: [] } });
  expect(result.body).not.toHaveProperty("unreadCount");
});

test("uses the extra inbox row only for pagination and loads references for the displayed page", async () => {
  const result = await contentRead("inbox", ({ ready }) => ready(Array.from({ length: 41 }, (_, index) => eventRow(41 - index))));
  expect(result).toMatchObject({ status: 200, body: { coverage: "partial", referenceCoverage: "partial",
    references: [{ itemId: "task-41" }] }, calls: { snapshot: 1, notificationReads: 0, count: 0 } });
  expect(result.body.events.map(event => event.id)).toEqual(Array.from({ length: 40 }, (_, index) => 41 - index));
  expect(result.body.continuation).toEqual(expect.any(String));
  expect(result.calls.references).toHaveLength(1);
  expect(result.calls.references[0]).not.toContain('"task-1"');
});

test("retries a stale content snapshot without publishing its page", async () => {
  const result = await contentRead("preview", ({ ready, revision, changeRevision }) => {
    if (revision === "notification-2") return ready([eventRow(18)]);
    const old = ready([eventRow(41)]);
    changeRevision("notification-2");
    return old;
  });
  expect(result).toMatchObject({ status: 200, body: { items: [{ id: 18 }], sourceRevision: "notification-2" },
    calls: { snapshot: 2, notificationReads: 0, count: 0 } });
});

test("does not turn a failed content snapshot into an empty inbox", async () => {
  const result = await contentRead("inbox", () => Response.json({ status: "unavailable" }));
  expect(result).toMatchObject({ status: 503, calls: { snapshot: 1, count: 0, notificationReads: 0 } });
  expect(result.body).not.toHaveProperty("events");
});
