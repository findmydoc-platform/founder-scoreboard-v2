import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
const view = (revision = "revision-a", userId = "user-a") => ({ revision, userId, user: { id: userId, email: "member@example.test" }, expiresAt: 2000000000 });
beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function adapter() { return (await importTestModule("src/lib/credentials/browser.ts")).createBrowserSessionAdapter(); }

test("browser consumers receive a safe server session view without SDK credentials", async () => {
  const fetch = vi.fn(async () => Response.json({ session: view() })); vi.stubGlobal("fetch", fetch);
  const session = await adapter();
  expect(await session.current()).toEqual(view());
  expect(String(fetch.mock.calls[0][0])).toBe("/api/auth/session");
  expect(JSON.stringify(await session.current())).not.toMatch(/accessToken|access_token|refresh_token/);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("equivalent concurrent recoveries share one server request and retain the expected identity", async () => {
  const fetch = vi.fn(async input => Response.json(String(input).endsWith("recover") ? { outcome: "refreshed", session: view("revision-b") } : { session: view() }));
  vi.stubGlobal("fetch", fetch); const session = await adapter(); const original = await session.current();
  expect(await Promise.all([session.recover(original), session.recover(original)])).toEqual([
    { kind: "refreshed", session: view("revision-b") }, { kind: "refreshed", session: view("revision-b") },
  ]);
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("recover"))).toHaveLength(1);
  expect(JSON.parse(fetch.mock.calls[1][1].body).expected).toMatchObject({ userId: "user-a", revision: "revision-a" });
});

test("a temporary recovery failure preserves the current session and never clears it", async () => {
  const fetch = vi.fn(async input => String(input).endsWith("recover") ? Response.json({ outcome: "temporarily_unavailable" }, { status: 503 }) : Response.json({ session: view() }));
  vi.stubGlobal("fetch", fetch); const session = await adapter(); const original = await session.current();
  expect(await session.recover(original)).toEqual({ kind: "temporarily_unavailable" });
  expect(await session.current()).toEqual(original);
  expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain("/api/auth/session/clear");
});

test("same-user newer revisions are reusable but another user cannot replay the old operation", async () => {
  let current = view();
  vi.stubGlobal("fetch", async input => Response.json(String(input).endsWith("recover") ? { outcome: "superseded", session: current } : { session: current }));
  const session = await adapter(); const original = await session.current(); current = view("newer");
  expect(await session.recover(original)).toEqual({ kind: "refreshed", session: current });
  current = view("different", "user-b"); await session.refresh();
  expect(await session.recover(original)).toEqual({ kind: "superseded" });
});

test("global logout clears subscribers immediately and a delayed recovery cannot restore protected identity", async () => {
  let release;
  vi.stubGlobal("fetch", async input => {
    if (String(input).endsWith("recover")) { await new Promise(resolve => { release = resolve; }); return Response.json({ outcome: "refreshed", session: view("late") }); }
    if (String(input).endsWith("logout")) return Response.json({ outcome: "cleared", session: null });
    return Response.json({ session: view() });
  });
  const session = await adapter(); const original = await session.current(); const changes = [];
  const unsubscribe = session.subscribe(value => changes.push(value));
  const recovering = session.recover(original);
  for (let attempt=0; attempt<50 && !release; attempt++) await Promise.resolve();
  expect(await session.logout()).toBe(true);
  expect(changes.at(-1)).toBeNull();
  release(); expect(await recovering).toEqual({ kind: "superseded" });
  expect(await session.current()).toBeNull(); unsubscribe();
});

test("login fails closed when browser locking is unavailable", async () => {
  vi.stubGlobal("navigator", {}); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await (await adapter()).startLogin("?next=/planning")).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

test("late protected API data is discarded after logout without replaying the operation", async () => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  vi.stubGlobal("fetch", async input => {
    if (String(input) === "/api/tasks") { entered(); await new Promise(resolve => { release = resolve; }); return Response.json({ privateTask: "old protected data" }); }
    return Response.json(String(input).endsWith("logout") ? { outcome: "cleared", session: null } : { session: view() });
  });
  const session = await adapter(); await session.current();
  const { createBrowserApiClient } = await importTestModule("src/lib/browser-api-client.ts");
  const pending = createBrowserApiClient({ sessionPort: session }).requestJson("/api/tasks"); await ready;
  expect(await session.logout()).toBe(true); release();
  const result = await pending;
  expect(result.response.status).toBe(409);
  expect(result.body).toMatchObject({ code: "session_superseded" });
  expect(JSON.stringify(result.body)).not.toContain("old protected data");
});
