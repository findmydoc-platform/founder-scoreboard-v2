import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const origin = "https://planning-service.example.test";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("a Planning SDK RPC retains its original operation signal until the response body completes", async () => {
  const controller = new AbortController();
  const beforeDispatch = vi.fn(async () => null), assertCurrent = vi.fn();
  let received, body, stop, enter;
  const entered = new Promise(resolve => { enter = resolve; });
  vi.stubGlobal("fetch", (input, init) => {
    const request = new Request(input, init);
    const signal = init?.signal || request.signal;
    received = { input, init, request };
    return Promise.resolve(new Response(new ReadableStream({
      start(stream) {
        body = stream;
        stop = () => stream.error(new DOMException("Operation cancelled", "AbortError"));
        if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
      },
      pull() { enter(); },
    }, { highWaterMark: 0 }), { status: 200, headers: { "content-type": "application/json" } }));
  });
  const { planningService } = await importTestModule("src/lib/credentials/internal/planning-service.ts", { "server-only": {} });
  const client = planningService(true, beforeDispatch, assertCurrent);
  const result = Promise.resolve(client.rpc("planning_deliverable_summaries", { p_selected_ids: ["synthetic-parent"] }).abortSignal(controller.signal));
  try {
    await entered;
    expect(beforeDispatch).toHaveBeenCalledTimes(1);
    expect(assertCurrent).toHaveBeenCalledTimes(1);
    expect(received.input).toBe(`${origin}/rest/v1/rpc/planning_deliverable_summaries`);
    expect(received.init.signal).toBe(controller.signal);
    expect(received.request.method).toBe("POST");
    expect(received.request.headers.get("authorization")).toBe("Bearer synthetic-service-key");
    expect(received.request.headers.get("apikey")).toBe("synthetic-service-key");
    expect(await received.request.json()).toEqual({ p_selected_ids: ["synthetic-parent"] });
    controller.abort();
    expect(received.init.signal.aborted).toBe(true);
    expect((await result).error?.message).toContain("AbortError");
  } finally {
    controller.abort();
    received?.request.signal.removeEventListener("abort", stop);
    received?.init?.signal?.removeEventListener("abort", stop);
    try { body?.error(new DOMException("Test cleanup", "AbortError")); } catch { /* The body may already be errored. */ }
    await result;
  }
});

test("Planning service fetch retains Request bodies, option overrides and headers", async () => {
  let received;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init);
    received = { request, body: await request.text() };
    return Response.json({ accepted: true });
  });
  const { planningService } = await importTestModule("src/lib/credentials/internal/planning-service.ts", {
    "server-only": {},
    "@supabase/supabase-js": { createClient: (_url, _key, options) => ({ fetch: options.global.fetch }) },
  });
  const controller = new AbortController();
  const input = new Request(`${origin}/rest/v1/rpc/planning_deliverable_summaries`, {
    method: "POST", body: "original-body", signal: controller.signal,
    headers: { authorization: "Bearer synthetic-original", "x-founderops-workspace-permit": "synthetic-permit" },
  });
  const response = await planningService(true).fetch(input, { cache: "no-store", body: "replacement-body" });
  expect(await response.json()).toEqual({ accepted: true });
  expect(received.request.method).toBe("POST");
  expect(received.request.cache).toBe("no-store");
  expect(received.request.headers.get("authorization")).toBe("Bearer synthetic-original");
  expect(received.request.headers.get("x-founderops-workspace-permit")).toBe("synthetic-permit");
  expect(received.body).toBe("replacement-body");
  controller.abort();
  expect(received.request.signal.aborted).toBe(true);
});
