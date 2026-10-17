import { createHmac } from "node:crypto";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const authOrigin = "https://decision-auth.example.test";
let jar, network, notionRequests, dataRequests, profileId, role, mapped, sharedCache;
function session(expires) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = expires ?? Math.floor(Date.now() / 1000) + 3600;
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "reader-user", iss: `${authOrigin}/auth/v1`, aud: "authenticated", role: "authenticated", session_id: "b1111111-1111-4111-8111-111111111111", exp })}`;
  return { access_token: `${body}.${createHmac("sha256", "synthetic-signature").update(body).digest("base64url")}`, refresh_token: "synthetic-session-refresh", expires_at: exp, expires_in: 3600, token_type: "bearer", user: { id: "reader-user", aud: "authenticated", user_metadata: {} } };
}
const page = id => ({ object: "page", id, url: `https://notion.so/${id}`, properties: { Decision: { title: [{ plain_text: "Beschluss" }] }, Datum: { date: { start: "2026-07-17" } } } });
const framework = () => ({
  "server-only": {},
  "next/headers": { cookies: async () => jar, headers: async () => new Headers({ host: "application.example.test" }) },
  "next/cache": { unstable_cache: (fn, keys) => async () => {
    const key = keys.join(":");
    if (!sharedCache.has(key)) sharedCache.set(key, await fn());
    return sharedCache.get(key);
  }, revalidateTag() {} },
  "next/navigation": { redirect: value => { throw Error(`redirect:${value}`); } },
  "@/features/planning/PlanningApp": { PlanningApp() { return null; } },
});
async function publicAccess() {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", framework());
  return authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "decision-log.read" });
}
async function render() {
  const { default: DecisionLogPage } = await importTestModule("src/app/(workspaces)/decision-log/page.tsx", framework());
  return DecisionLogPage();
}
beforeEach(() => {
  vi.resetModules(); notionRequests = []; dataRequests = []; profileId = "reader-profile"; role = "viewer"; mapped = true; sharedCache = new Map();
  const values = new Map([["sb-decision-auth-auth-token", `base64-${Buffer.from(JSON.stringify(session())).toString("base64url")}`]]);
  jar = { getAll: () => [...values].map(([name, value]) => ({ name, value })), set: (name, value, options) => { if (options?.maxAge === 0) values.delete(name); else values.set(name, value); } };
  for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: authOrigin, SUPABASE_URL: authOrigin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_PUBLISHABLE_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", SUPABASE_SECRET_KEY: "synthetic-service", REQUIRE_SUPABASE_AUTH: "true", VERCEL_ENV: "preview",
    NOTION_DECISION_LOG_ENABLED: "true", NOTION_DECISION_LOG_TOKEN: "synthetic-notion", NOTION_DECISION_LOG_DATA_SOURCE_ID: "collection://fixed-source" })) vi.stubEnv(name, value);
  network = async request => {
    const url = new URL(request.url);
    if (url.origin === "https://api.notion.com") { notionRequests.push(request); return Response.json({ results: [page("decision-1")], has_more: false }); }
    if (url.origin !== authOrigin) throw Error("Unscripted external protocol");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "reader-user", aud: "authenticated", user_metadata: {} });
    if (url.pathname.endsWith("/rpc/workspace_access_context")) return Response.json({ mode: "legacy", linkingEnforced: false, userId: "reader-user", profileId: mapped ? profileId : null, linked: false, identity: null });
    if (url.pathname.endsWith("/rpc/current_authenticated_profile")) return Response.json({ id: profileId, name: "Reader", platform_role: role });
    if (url.pathname.endsWith("/rpc/administrator_access_snapshot")) return Response.json({ eligible: false, active: false });
    if (url.pathname.startsWith("/rest/v1/")) { dataRequests.push(request); return Response.json([], { headers: { "content-range": "*/0" } }); }
    throw Error(`Unscripted protocol ${url.pathname}`);
  };
  vi.stubGlobal("fetch", (input, init) => network(new Request(input, init)));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("the actual Decision Log page and public reader action use the fixed Notion query without exposing credentials", async () => {
  const rendered = await render();
  expect(rendered.props.initialDecisionLogResult).toMatchObject({ ok: true, entries: [{ id: "decision-1", decision: "Beschluss" }] });
  expect(JSON.stringify(rendered.props)).not.toContain("synthetic-notion");
  const permission = await publicAccess();
  expect(permission.ok).toBe(true);
  expect(Object.keys(permission.notion)).toEqual(["queryPage"]);
  await permission.notion.queryPage("next-page");
  expect(notionRequests).toHaveLength(2);
  expect(notionRequests[1].url).toBe("https://api.notion.com/v1/data_sources/fixed-source/query");
  expect(notionRequests[1].headers.get("authorization")).toBe("Bearer synthetic-notion");
  expect(notionRequests[1].method).toBe("POST");
  expect(await notionRequests[1].json()).toEqual({ page_size: 100, sorts: [{ property: "Datum", direction: "descending" }], start_cursor: "next-page" });
  expect(dataRequests.filter(request => new URL(request.url).pathname.endsWith("notification_events")).every(request => new URL(request.url).searchParams.get("recipient_profile_id") === "eq.reader-profile")).toBe(true);
});

test.each(["ceo", "founder", "deputy", "viewer"])("the existing %s reader retains the same recipient and operational-lead header filter", async readerRole => {
  role = readerRole;
  const rendered = await render();
  expect(rendered.props.initialDecisionLogResult.ok).toBe(true);
  const notifications = dataRequests.filter(request => new URL(request.url).pathname.endsWith("notification_events"));
  expect(notifications.length).toBeGreaterThan(0);
  for (const request of notifications) {
    const query = new URL(request.url).searchParams;
    expect(query.get("status")).toBe("eq.pending");
    if (["ceo", "deputy"].includes(readerRole)) expect(query.get("or")).toBe("(recipient_profile_id.eq.reader-profile,recipient_profile_id.is.null)");
    else expect(query.get("recipient_profile_id")).toBe("eq.reader-profile");
  }
});

test.each(["anonymous", "unmapped", "wrong-role"])("%s callers cannot load provider data through the actual page or public reader seam", async caller => {
  if (caller === "anonymous") jar.getAll().forEach(cookie => jar.set(cookie.name, "", { maxAge: 0 }));
  if (caller === "unmapped") mapped = false;
  if (caller === "wrong-role") role = "technical-bot";
  const rendered = await render();
  expect(rendered.props.initialProtectedDataLoaded).not.toBe(true);
  expect((await publicAccess()).ok).toBe(false);
  expect(notionRequests).toHaveLength(0);
  expect(dataRequests).toHaveLength(0);
});

test("a usable technical configuration never authorizes another credential kind", async () => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", framework());
  expect(await authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "decision-log.read" })).toMatchObject({ ok: false, status: 403 });
  expect(notionRequests).toHaveLength(0);
});

test.each(["NOTION_DECISION_LOG_TOKEN", "NOTION_DECISION_LOG_DATA_SOURCE_ID", "NOTION_DECISION_LOG_ENABLED"])("missing or disabled %s retains the page configuration result without provider access", async key => {
  vi.stubEnv(key, key.endsWith("ENABLED") ? "false" : "");
  const rendered = await render();
  expect(rendered.props.initialDecisionLogResult).toMatchObject({ ok: false, code: "missing_configuration" });
  expect(notionRequests).toHaveLength(0);
});

test.each(["denied", "outage", "network", "invalid", "empty"])("the actual page retains the %s provider result without leaking diagnostics", async outcome => {
  const previous = network;
  network = async request => {
    if (new URL(request.url).hostname !== "api.notion.com") return previous(request);
    notionRequests.push(request);
    if (outcome === "network") throw Error("synthetic-notion");
    if (outcome === "denied" || outcome === "outage") return new Response("synthetic-notion", { status: outcome === "denied" ? 403 : 503 });
    return Response.json(outcome === "invalid" ? { unsafe: "synthetic-notion" } : { results: [] });
  };
  const rendered = await render();
  expect(rendered.props.initialDecisionLogResult).toMatchObject(outcome === "empty" ? { ok: true, entries: [] } : { ok: false, code: outcome === "invalid" ? "invalid_response" : "notion_unavailable" });
  expect(JSON.stringify(rendered.props)).not.toContain("synthetic-notion");
});

test("pagination keeps the fixed source and rejects repeated cursors", async () => {
  const previous = network;
  network = async request => {
    if (new URL(request.url).hostname !== "api.notion.com") return previous(request);
    notionRequests.push(request);
    return Response.json({ results: [page(`decision-${notionRequests.length}`)], has_more: true, next_cursor: "same-cursor" });
  };
  const rendered = await render();
  expect(rendered.props.initialDecisionLogResult).toMatchObject({ ok: false, code: "invalid_response" });
  expect(notionRequests).toHaveLength(2);
  expect(notionRequests.every(request => request.url === "https://api.notion.com/v1/data_sources/fixed-source/query")).toBe(true);
});

test.each(["binding", "role"])("an issued reader cannot continue after its live %s changes", async changed => {
  const permission = await publicAccess();
  if (changed === "binding") mapped = false;
  else role = "ceo";
  await expect(permission.notion.queryPage()).rejects.toThrow();
  await expect(permission.loadHeader()).rejects.toThrow();
  expect(notionRequests).toHaveLength(0);
  expect(dataRequests).toHaveLength(0);
});

test.each(["token", "source", "enabled"])("late Notion %s configuration changes deny the issued fixed-target transport", async change => {
  const permission = await publicAccess();
  const previous = network;
  network = async request => {
    const response = await previous(request);
    if (new URL(request.url).pathname.endsWith("/rpc/current_authenticated_profile")) {
      vi.stubEnv(change === "token" ? "NOTION_DECISION_LOG_TOKEN" : change === "source" ? "NOTION_DECISION_LOG_DATA_SOURCE_ID" : "NOTION_DECISION_LOG_ENABLED", change === "enabled" ? "false" : "replacement");
    }
    return response;
  };
  await expect(permission.notion.queryPage()).rejects.toThrow();
  expect(notionRequests).toHaveLength(0);
});

test("pagination retains its original fifteen-second budget independently of the session deadline", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const permission = await publicAccess();
  const timeouts = [];
  const originalTimeout = AbortSignal.timeout;
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => { timeouts.push(ms); return originalTimeout(ms); });
  const previous = network;
  network = async request => {
    if (new URL(request.url).hostname !== "api.notion.com") return previous(request);
    notionRequests.push(request); now += 7000;
    return Response.json({ results: [], has_more: true, next_cursor: `cursor-${notionRequests.length}` });
  };
  await permission.notion.queryPage();
  await permission.notion.queryPage("cursor-1");
  now += 1000;
  await expect(permission.notion.queryPage("cursor-2")).rejects.toThrow();
  expect(notionRequests).toHaveLength(2);
  expect(timeouts.filter(ms => ms === 8000)).toHaveLength(2);
});

test("a provider response arriving at the eight-second request deadline is unavailable", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const previous = network;
  network = async request => {
    if (new URL(request.url).hostname !== "api.notion.com") return previous(request);
    now += 8000; return Response.json({ results: [], has_more: false });
  };
  const rendered = await render();
  expect(rendered.props.initialDecisionLogResult).toMatchObject({ ok: false, code: "notion_unavailable" });
});

test("a session deadline crossed during the final authoritative read prevents provider dispatch", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const deadline = (Math.floor(now / 1000) + 2) * 1000;
  const stored = { ...session(deadline / 1000), expires_at: Math.floor(now / 1000) + 3600 };
  jar.set("sb-decision-auth-auth-token", `base64-${Buffer.from(JSON.stringify(stored)).toString("base64url")}`);
  const permission = await publicAccess();
  const previous = network;
  network = async request => {
    const response = await previous(request);
    if (new URL(request.url).pathname.endsWith("/rpc/current_authenticated_profile")) now = deadline;
    return response;
  };
  await expect(permission.notion.queryPage()).rejects.toThrow();
  expect(notionRequests).toHaveLength(0);
});

test("the page rejects an actor role changed between shell and Decision Log capability acquisition", async () => {
  const previous = network; let profiles = 0;
  network = async request => {
    if (new URL(request.url).pathname.endsWith("/rpc/current_authenticated_profile") && ++profiles >= 2) role = "ceo";
    return previous(request);
  };
  const rendered = await render();
  expect(rendered.props.initialDecisionLogResult).toBeUndefined();
  expect(notionRequests).toHaveLength(0);
  expect(dataRequests).toHaveLength(0);
});

test("configuration changed during capability acquisition renders the established unavailable page without provider dispatch", async () => {
  const previous = network; let profiles = 0;
  network = async request => {
    const response = await previous(request);
    if (new URL(request.url).pathname.endsWith("/rpc/current_authenticated_profile") && ++profiles >= 3) vi.stubEnv("NOTION_DECISION_LOG_TOKEN", "replacement");
    return response;
  };
  const rendered = await render();
  expect(rendered.props.initialDecisionLogResult).toBeUndefined();
  expect(notionRequests).toHaveLength(0);
});

test("valid pagination maps and sorts every fixed-source page without permitting caller-selected request options", async () => {
  const previous = network;
  network = async request => {
    if (new URL(request.url).hostname !== "api.notion.com") return previous(request);
    notionRequests.push(request);
    return Response.json({ results: [page(notionRequests.length === 1 ? "z-last" : "a-first")], has_more: notionRequests.length === 1, next_cursor: notionRequests.length === 1 ? "next" : null });
  };
  const rendered = await render();
  expect(rendered.props.initialDecisionLogResult.entries.map(entry => entry.id)).toEqual(["a-first", "z-last"]);
  expect(await notionRequests[1].json()).toMatchObject({ start_cursor: "next", page_size: 100 });
  const permission = await publicAccess();
  const arbitraryFetch = vi.fn();
  await permission.notion.queryPage("", { url: "https://unrelated.example.test", headers: { Authorization: "replacement" }, fetch: arbitraryFetch, totalTimeoutMs: 999999 });
  expect(arbitraryFetch).not.toHaveBeenCalled();
  expect(notionRequests[2].url).toBe("https://api.notion.com/v1/data_sources/fixed-source/query");
  expect(notionRequests[2].headers.get("authorization")).toBe("Bearer synthetic-notion");
});

test("warm shared header data requires current reader authority and never caches recipient notifications", async () => {
  const permission = await publicAccess();
  await permission.loadHeader();
  const sharedReads = () => dataRequests.filter(request => ["/rest/v1/fmd_tools", "/rest/v1/founder_events"].includes(new URL(request.url).pathname)).length;
  expect(sharedReads()).toBe(2);
  const firstNotificationReads = dataRequests.length - sharedReads();
  await permission.loadHeader();
  expect(sharedReads()).toBe(2);
  expect(dataRequests.length - sharedReads()).toBe(firstNotificationReads * 2);
  const dataCount = dataRequests.length;
  mapped = false;
  await expect(permission.loadHeader()).rejects.toThrow();
  expect(dataRequests).toHaveLength(dataCount);
});

test("changed database configuration after the final header authorization read cannot dispatch the old service credential", async () => {
  const permission = await publicAccess();
  const previous = network;
  network = async request => {
    const response = await previous(request);
    if (new URL(request.url).pathname.endsWith("/rpc/current_authenticated_profile")) vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "replacement-service");
    return response;
  };
  await expect(permission.loadHeader()).rejects.toThrow();
  expect(dataRequests).toHaveLength(0);
});
