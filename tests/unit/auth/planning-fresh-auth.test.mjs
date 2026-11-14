import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

let protocol, counters;

// Model the documented render-lifetime GET memoization at the fetch boundary.
// Store a pristine cloned response and clone for every caller, so consumed
// bodies cannot manufacture the denial or the regression under test.
function memoizedTransport(upstream) {
  const entries = new Map();
  return (input, init) => {
    const request = new Request(input, init);
    if (!["GET", "HEAD"].includes(request.method) || init?.signal || request.keepalive) return upstream(input, init);
    const key = JSON.stringify([request.url, request.method, [...request.headers].sort()]);
    if (!entries.has(key)) entries.set(key, Promise.resolve(upstream(input, init)).then(response => response.clone()));
    return entries.get(key).then(response => response.clone());
  };
}

const nextCache = {
  unstable_cache(producer) {
    let cached;
    return (...args) => cached ||= Promise.resolve(producer(...args));
  },
};

beforeEach(() => {
  vi.resetModules();
  protocol = administratorProtocol();
  counters = { auth: 0, data: 0 };
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", memoizedTransport(async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/auth/v1/user") counters.auth++;
    if (request.method === "GET" && url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) {
      counters.data++;
      if (url.pathname.endsWith("/projects")) return Response.json({ id: "findmydoc-founder-execution", name: "Synthetic protected project" });
      if (url.pathname.endsWith("/profiles")) return Response.json([
        { id: "synthetic-profile", name: "Synthetic protected profile", platform_role: "founder", org_role: "", weekly_capacity: 40 },
      ], { headers: { "content-range": "0-0/1" } });
      return Response.json([], { headers: { "content-range": "*/0" } });
    }
    return original(input, init);
  }));
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function authorize(action) {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {}, "next/cache": nextCache });
  return authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action });
}

test("a bound Board query rejects a newly denied original JWT despite an earlier memoized Auth GET", async () => {
  const permission = await authorize("planning.board.read");
  expect(permission.ok).toBe(true);
  const before = { ...counters };
  protocol.state.authError = 400;

  const result = await permission.planning.startBoardQuery({ view: "board", filters: { query: "synthetic" } });
  expect(result.status).toBe("forbidden");
  expect("model" in result).toBe(false);
  expect(counters.auth).toBeGreaterThan(before.auth);
  expect(counters.data).toBe(before.data);
  expect(protocol.calls.some(call => call.name === "planning_deliverable_query_plan")).toBe(false);
});

test("a warm Header data cache cannot bypass a fresh denial of the original JWT", async () => {
  const permission = await authorize("planning.header.read");
  expect(permission.ok).toBe(true);
  expect((await permission.planning.loadHeader(["quickLinks"])).ok).toBe(true);
  const before = { ...counters };
  protocol.state.authError = 400;

  const result = await permission.planning.loadHeader(["quickLinks"]);
  expect(result.ok).toBe(false);
  expect(result.status).toBe(403);
  expect("headerData" in result).toBe(false);
  expect(counters.auth).toBeGreaterThan(before.auth);
  expect(counters.data).toBe(before.data);
});

test("a retained Profile GET cannot authorize another read after the original JWT is denied", async () => {
  const permission = await authorize("account.profile.read");
  expect(permission.ok).toBe(true);
  expect((await permission.account.loadProfile()).status).toBe("ready");
  const before = { ...counters };
  protocol.state.authError = 400;

  const result = await permission.account.loadProfile();
  expect(result.status).toBe("unavailable");
  expect("model" in result).toBe(false);
  expect(counters.auth).toBeGreaterThan(before.auth);
  expect(counters.data).toBe(before.data);
});

test.each(["request", "init"])("fresh Auth GETs retain %s AbortSignal semantics", async kind => {
  const controller = new AbortController();
  const input = kind === "request"
    ? new Request("https://auth.example.test/auth/v1/user", { signal: controller.signal })
    : "https://auth.example.test/auth/v1/user";
  const init = kind === "init" ? { signal: controller.signal } : undefined;
  let status = 200, waiting = false, receivedSignal;
  let enter;
  const entered = new Promise(resolve => { enter = resolve; });
  vi.stubGlobal("fetch", memoizedTransport((nextInput, nextInit) => {
    const request = new Request(nextInput, nextInit);
    if (!waiting) return Response.json({ accepted: status === 200 }, { status });
    receivedSignal = request.signal;
    enter();
    return new Promise((_resolve, reject) => {
      const stop = () => reject(new DOMException("Synthetic caller aborted", "AbortError"));
      if (request.signal.aborted) stop(); else request.signal.addEventListener("abort", stop, { once: true });
    });
  }));
  const { observedSupabaseFetch } = await importTestModule("src/lib/credentials/internal/observed-fetch.ts", { "server-only": {} });
  const first = await observedSupabaseFetch(input, init);
  expect(first.status).toBe(200);
  expect((await first.json()).accepted).toBe(true);
  status = 400;
  const denied = await observedSupabaseFetch(input, init);
  expect(denied.status).toBe(400);
  expect((await denied.json()).accepted).toBe(false);
  waiting = true;
  const pending = observedSupabaseFetch(input, init);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await entered;
  controller.abort();
  await rejected;
  expect(receivedSignal?.aborted).toBe(true);
});
