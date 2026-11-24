import { expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const { createSupabaseNotificationsReadModel } = await importTestModule("src/features/notifications/server/notifications-read-model-supabase.ts", { "server-only": {} });

test("an authorized viewer can load their unread preview while an exact-count request is unavailable", async () => {
  const rows = [
    { id: 1, type: "task.mention", actor_profile_id: "actor", recipient_profile_id: "viewer", entity_type: "task", entity_id: "task-1", title: "Own unread", body: "", created_at: "2026-11-19T12:00:00Z", status: "pending", seen_at: null },
    { id: 2, type: "task.mention", actor_profile_id: "actor", recipient_profile_id: "other", entity_type: "task", entity_id: "task-2", title: "Other user", body: "", created_at: "2026-11-19T13:00:00Z", status: "pending", seen_at: null },
    { id: 3, type: "task.mention", actor_profile_id: "actor", recipient_profile_id: null, entity_type: "task", entity_id: "task-3", title: "Lead broadcast", body: "", created_at: "2026-11-19T14:00:00Z", status: "pending", seen_at: null },
  ];
  const fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (request.headers.get("prefer")?.includes("count=exact")) return Response.json({ message: "count unavailable" }, { status: 503 });
    if (!url.pathname.endsWith("/notification_events")) throw new Error("Unexpected read");
    const visible = rows.filter(row => url.searchParams.get("recipient_profile_id") === `eq.${row.recipient_profile_id}`
      && url.searchParams.get("status") === `eq.${row.status}` && url.searchParams.get("seen_at") === "is.null" && row.seen_at === null);
    return Response.json(visible);
  };
  const supabase = createClient("http://localhost:3000", "synthetic-key", { global: { fetch }, db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false } });
  const result = await createSupabaseNotificationsReadModel(supabase).loadPreview({ authorized: true, actorProfileId: "viewer", platformRole: "viewer" });
  expect(result).toMatchObject({ status: "ready", items: [{ id: 1, title: "Own unread", entityId: "task-1" }] });
  expect(result.items).toHaveLength(1);
});

test("an exact authorized unread count remains available when preview loading fails", async () => {
  const fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (!url.pathname.endsWith("/notification_events")) throw new Error("Unexpected read");
    if (request.method !== "HEAD") return Response.json({ message: "preview unavailable" }, { status: 503 });
    expect(url.searchParams.get("recipient_profile_id")).toBe("eq.viewer");
    expect(url.searchParams.get("status")).toBe("eq.pending");
    expect(url.searchParams.get("seen_at")).toBe("is.null");
    return new Response(null, { headers: { "content-range": "*/1041" } });
  };
  const supabase = createClient("http://localhost:3000", "synthetic-key", { global: { fetch }, db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false } });
  const result = await createSupabaseNotificationsReadModel(supabase).loadUnreadCount({ authorized: true, actorProfileId: "viewer", platformRole: "viewer" });
  expect(result).toEqual({ status: "ready", unreadCount: 1041 });
});

test("a missing exact unread count remains unavailable rather than becoming zero", async () => {
  const supabase = createClient("http://localhost:3000", "synthetic-key", { global: { fetch: async () => new Response(null) }, db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false } });
  const result = await createSupabaseNotificationsReadModel(supabase).loadUnreadCount({ authorized: true, actorProfileId: "viewer", platformRole: "viewer" });
  expect(result).toEqual({ status: "unavailable" });
});

test("unauthorized or unmapped actors cannot dispatch preview or count reads", async () => {
  let calls = 0;
  const supabase = createClient("http://localhost:3000", "synthetic-key", { global: { fetch: async () => { calls++; throw new Error("Unexpected request"); } }, db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false } });
  const reader = createSupabaseNotificationsReadModel(supabase);
  expect(await reader.loadPreview({ authorized: false, actorProfileId: "viewer", platformRole: "viewer" })).toEqual({ status: "forbidden" });
  expect(await reader.loadUnreadCount({ authorized: true, actorProfileId: null, platformRole: "viewer" })).toEqual({ status: "forbidden" });
  expect(calls).toBe(0);
});

test("a cancelled scoped preview does not dispatch a protected read", async () => {
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  const supabase = createClient("http://localhost:3000", "synthetic-key", { global: { fetch: async () => { calls++; throw new Error("Unexpected request"); } }, db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false } });
  const result = await createSupabaseNotificationsReadModel(supabase).loadPreview({ authorized: true, actorProfileId: "viewer", platformRole: "viewer", signal: controller.signal });
  expect(result).toEqual({ status: "unavailable" });
  expect(calls).toBe(0);
});

test("an operational lead's exact count includes team broadcasts without including another recipient", async () => {
  const rows = ["lead", null, "other"];
  const fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    const scope = url.searchParams.get("or");
    const visible = rows.filter(recipient => recipient === "lead" && scope?.includes('recipient_profile_id.eq."lead"') || recipient === null && scope?.includes("recipient_profile_id.is.null"));
    return new Response(null, { headers: { "content-range": `*/${visible.length}` } });
  };
  const supabase = createClient("http://localhost:3000", "synthetic-key", { global: { fetch }, db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false } });
  expect(await createSupabaseNotificationsReadModel(supabase).loadUnreadCount({ authorized: true, actorProfileId: "lead", platformRole: "ceo" })).toEqual({ status: "ready", unreadCount: 2 });
});

test("an operational lead's unusual profile identity cannot broaden the unread-count scope", async () => {
  const profileId = 'lead),recipient_profile_id.eq.other"\\';
  const fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    expect(url.searchParams.get("or")).toBe('(recipient_profile_id.eq."lead),recipient_profile_id.eq.other\\"\\\\",recipient_profile_id.is.null)');
    return new Response(null, { headers: { "content-range": "*/0" } });
  };
  const supabase = createClient("http://localhost:3000", "synthetic-key", { global: { fetch }, db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false } });
  expect(await createSupabaseNotificationsReadModel(supabase).loadUnreadCount({ authorized: true, actorProfileId: profileId, platformRole: "ceo" })).toEqual({ status: "ready", unreadCount: 0 });
});

test("an inbox page selects the authorized scope before its limit and preserves further-page coverage", async () => {
  const ownRows = Array.from({ length: 45 }, (_, index) => ({ id: 100 - index, type: "task.mention", actor_profile_id: "actor", recipient_profile_id: "viewer",
    entity_type: "task", entity_id: `task-${index}`, title: `Own ${index}`, body: "", status: "pending", seen_at: null, created_at: `2026-11-19T12:00:${String(59 - index).padStart(2, "0")}.000Z` }));
  const fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname.endsWith("/active_tasks")) return Response.json([]);
    if (!url.pathname.endsWith("/notification_events")) throw new Error("Unexpected read");
    if (url.searchParams.get("recipient_profile_id") !== "eq.viewer") return Response.json([{ ...ownRows[0], recipient_profile_id: "foreign" }]);
    return Response.json(ownRows.slice(0, Number(url.searchParams.get("limit"))));
  };
  const supabase = createClient("http://localhost:3000", "synthetic-key", { global: { fetch }, db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false } });
  const result = await createSupabaseNotificationsReadModel(supabase).loadInbox({ authorized: true, actorProfileId: "viewer", platformRole: "viewer", limit: 40 });
  expect(result.status).toBe("ready");
  expect(result.events).toHaveLength(40);
  expect(result.events[0]).toMatchObject({ id: 100, recipientProfileId: "viewer", title: "Own 0" });
  expect(result.coverage).toBe("partial");
  expect(result.next).toEqual({ createdAt: ownRows[39].created_at, id: 61 });
  expect(result.referenceCoverage).toBe("partial");
});

test("an inbox entry without a target identity does not certify complete reference coverage", async () => {
  const fetch = async () => Response.json([{ id: 1, type: "task.mention", actor_profile_id: "actor", recipient_profile_id: "viewer",
    entity_type: "task", entity_id: "", title: "Unknown target", status: "pending", created_at: "2026-11-19T12:00:00.000Z" }]);
  const supabase = createClient("http://localhost:3000", "synthetic-key", { global: { fetch }, db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false } });
  const result = await createSupabaseNotificationsReadModel(supabase).loadInbox({ authorized: true, actorProfileId: "viewer", platformRole: "viewer", limit: 40 });
  expect(result.status).toBe("ready");
  expect(result.referenceCoverage).toBe("partial");
});
