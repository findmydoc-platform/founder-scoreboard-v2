import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const { createBrowserApiClient } = await importTestModule("src/lib/browser-api-client.ts");
const originalFetch = globalThis.fetch;
const currentSession = { userId: "user-a", revision: "current", expiresAt: 4_000_000_000 };
const refreshedSession = { ...currentSession, revision: "refreshed" };

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function sessionPort(overrides = {}) {
  return {
    current: vi.fn().mockResolvedValue(currentSession),
    recover: vi.fn().mockResolvedValue({ kind: "refreshed", session: refreshedSession }),
    clearIfCurrent: vi.fn().mockResolvedValue(undefined),
    isCurrent: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

function markedUnauthorized() {
  return Response.json({ code: "session_invalid_before_effect" }, { status: 401 });
}

for (const recovery of [false, true]) {
  test(`response headers arrive while the successful body remains unread${recovery ? " after session recovery" : ""}`, async () => {
    let controller;
    const pull = vi.fn();
    const body = new ReadableStream({
      start(value) { controller = value; },
      pull,
    }, { highWaterMark: 0 });
    const response = new Response(body, { headers: { "content-type": "application/octet-stream" } });
    const clone = vi.spyOn(response, "clone");
    const port = sessionPort();
    const client = createBrowserApiClient({ sessionPort: port });
    const fetchMock = vi.fn().mockResolvedValue(response);
    if (recovery) fetchMock.mockResolvedValueOnce(markedUnauthorized());
    globalThis.fetch = fetchMock;

    let received;
    const pending = client.requestResponse("/api/download", { expectedSession: currentSession })
      .then(value => { received = value; });
    let closed = false;
    try {
      await vi.waitFor(() => assert.equal(received, response), { timeout: 200, interval: 1 });
      assert.equal(response.bodyUsed, false);
      assert.equal(body.locked, false);
      assert.equal(pull.mock.calls.length, 0);
      assert.equal(clone.mock.calls.length, 0);
      controller.enqueue(new TextEncoder().encode("first"));
      const reader = received.body.getReader();
      assert.deepEqual(await reader.read(), { value: new TextEncoder().encode("first"), done: false });
      await reader.cancel();
      closed = true;
      assert.equal(fetchMock.mock.calls.length, recovery ? 2 : 1);
      assert.equal(port.recover.mock.calls.length, recovery ? 1 : 0);
    } finally {
      if (!closed) controller.close();
      await pending;
    }
  });
}

test("response requests retain cookie credentials, URL input, caller headers and the development profile", async () => {
  const port = sessionPort();
  const client = createBrowserApiClient({ sessionPort: port, devProfileId: "profile-a", devProfileOverrideEnabled: true });
  const fetchMock = vi.fn().mockResolvedValue(new Response(null));
  globalThis.fetch = fetchMock;
  const input = new URL("http://localhost:3000/api/download");
  const signal = new AbortController().signal;

  await client.requestResponse(input, { signal, headers: { accept: "application/octet-stream" }, expectedSession: currentSession });

  const [sentInput, options] = fetchMock.mock.calls[0];
  assert.equal(sentInput, input);
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.signal, signal);
  assert.equal(new Headers(options.headers).get("accept"), "application/octet-stream");
  assert.equal(new Headers(options.headers).get("x-fmd-dev-profile-id"), "profile-a");
  assert.equal(new Headers(options.headers).has("authorization"), false);
  assert.equal(Object.hasOwn(options, "expectedSession"), false);
});

test("response options retain explicit credentials and development-profile overrides", async () => {
  const client = createBrowserApiClient({ sessionPort: sessionPort(), devProfileId: "profile-a", devProfileOverrideEnabled: true });
  const fetchMock = vi.fn().mockImplementation(async () => new Response(null));
  globalThis.fetch = fetchMock;

  await client.requestResponse("/api/download", { credentials: "omit", useDevProfileOverride: false });
  await client.requestResponse("/api/download", { headers: { "x-fmd-dev-profile-id": "profile-b" } });

  assert.equal(fetchMock.mock.calls[0][1].credentials, "omit");
  assert.equal(new Headers(fetchMock.mock.calls[0][1].headers).has("x-fmd-dev-profile-id"), false);
  assert.equal(new Headers(fetchMock.mock.calls[1][1].headers).get("x-fmd-dev-profile-id"), "profile-b");
});

test("aborting a pending response request rejects without recovering or clearing its session", async () => {
  const abort = new AbortController();
  const port = sessionPort();
  const client = createBrowserApiClient({ sessionPort: port });
  let dispatched;
  const started = new Promise(resolve => { dispatched = resolve; });
  globalThis.fetch = vi.fn((_input, options) => new Promise((_resolve, reject) => {
    assert.equal(options.signal, abort.signal);
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    dispatched();
  }));

  const pending = client.requestResponse("/api/download", { signal: abort.signal });
  await started;
  const reason = new DOMException("Cancelled", "AbortError");
  abort.abort(reason);

  await assert.rejects(pending, error => error === reason);
  assert.equal(port.recover.mock.calls.length, 0);
  assert.equal(port.clearIfCurrent.mock.calls.length, 0);
});

for (const [name, snapshot, expected, isCurrent] of [
  ["missing", null, currentSession, true],
  ["another account", { ...currentSession, userId: "user-b" }, currentSession, true],
  ["another revision", refreshedSession, currentSession, true],
  ["expired", { ...currentSession, expiresAt: 1 }, currentSession, true],
  ["revoked", currentSession, currentSession, false],
  ["obsolete owner", currentSession, { ...currentSession, isCurrent: () => false }, true],
]) {
  test(`bound response requests reject ${name} authority before dispatch`, async () => {
    const port = sessionPort({ current: vi.fn().mockResolvedValue(snapshot), isCurrent: () => isCurrent });
    const client = createBrowserApiClient({ sessionPort: port });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const response = await client.requestResponse("/api/download", { expectedSession: expected });

    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "session_superseded");
    assert.equal(fetchMock.mock.calls.length, 0);
    assert.equal(port.recover.mock.calls.length, 0);
  });
}

test("a session superseded before response headers cannot hand back protected bytes", async () => {
  let alive = true;
  const port = sessionPort({ isCurrent: () => alive });
  const client = createBrowserApiClient({ sessionPort: port });
  const protectedResponse = new Response("protected");
  globalThis.fetch = vi.fn(async () => { alive = false; return protectedResponse; });

  const response = await client.requestResponse("/api/download", { expectedSession: currentSession });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "session_superseded");
  assert.equal(protectedResponse.bodyUsed, false);
});

test("a second marked unauthorized response clears only the recovered session without a third request", async () => {
  const port = sessionPort();
  const client = createBrowserApiClient({ sessionPort: port });
  const fetchMock = vi.fn().mockImplementation(async () => markedUnauthorized());
  globalThis.fetch = fetchMock;

  const response = await client.requestResponse("/api/download", { expectedSession: currentSession });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "session_invalid_before_effect");
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.deepEqual(port.recover.mock.calls, [[currentSession]]);
  assert.deepEqual(port.clearIfCurrent.mock.calls, [[refreshedSession]]);
});

for (const kind of ["temporarily_unavailable", "superseded"]) {
  test(`failed session recovery (${kind}) preserves the original unauthorized response`, async () => {
    const port = sessionPort({ recover: vi.fn().mockResolvedValue({ kind }) });
    const client = createBrowserApiClient({ sessionPort: port });
    const original = markedUnauthorized();
    const fetchMock = vi.fn().mockResolvedValue(original);
    globalThis.fetch = fetchMock;

    const response = await client.requestResponse("/api/download");

    assert.equal(response, original);
    assert.equal(response.bodyUsed, false);
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(port.clearIfCurrent.mock.calls.length, 0);
  });
}

for (const [name, recovered, isCurrent] of [
  ["another account", { ...refreshedSession, userId: "user-b" }, true],
  ["expired", { ...refreshedSession, expiresAt: 1 }, true],
  ["revoked", refreshedSession, false],
]) {
  test(`bound response requests never replay under ${name} recovered authority`, async () => {
    let recovering = false;
    const port = sessionPort({
      recover: vi.fn(async () => { recovering = true; return { kind: "refreshed", session: recovered }; }),
      isCurrent: () => !recovering || isCurrent,
    });
    const client = createBrowserApiClient({ sessionPort: port });
    const fetchMock = vi.fn().mockImplementation(async () => markedUnauthorized());
    globalThis.fetch = fetchMock;

    const response = await client.requestResponse("/api/download", { expectedSession: currentSession });

    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "session_superseded");
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(port.clearIfCurrent.mock.calls.length, 0);
  });
}

for (const [name, response, options] of [
  ["unmarked upstream denial", () => Response.json({ error: "Upstream unauthorized" }, { status: 401 }), {}],
  ["non-replayable mutation", markedUnauthorized, { method: "POST" }],
  ["caller authorization", markedUnauthorized, { headers: { authorization: "Bearer caller-token" } }],
]) {
  test(`response requests do not recover or replay ${name}`, async () => {
    const port = sessionPort();
    const client = createBrowserApiClient({ sessionPort: port });
    const fetchMock = vi.fn().mockImplementation(async () => response());
    globalThis.fetch = fetchMock;

    const received = await client.requestResponse("/api/download", options);

    assert.equal(received.status, 401);
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(port.recover.mock.calls.length, 0);
    assert.equal(port.clearIfCurrent.mock.calls.length, 0);
    if (name === "caller authorization") {
      assert.equal(port.current.mock.calls.length, 0);
      assert.equal(new Headers(fetchMock.mock.calls[0][1].headers).get("authorization"), "Bearer caller-token");
    }
  });
}

for (const [code, target] of [
  ["workspace_link_required", "/auth/link-google"],
  ["workspace_google_login_required", "/auth/login?provider=google"],
]) {
  for (const recovery of [false, true]) {
    test(`workspace ${code} transitions once${recovery ? " after replay" : ""} while retaining the linking session`, async () => {
      const port = sessionPort();
      const onWorkspaceTransition = vi.fn();
      const client = createBrowserApiClient({ sessionPort: port, onWorkspaceTransition });
      const fetchMock = vi.fn().mockImplementation(async () => Response.json({ code }, { status: 403 }));
      if (recovery) fetchMock.mockResolvedValueOnce(markedUnauthorized());
      globalThis.fetch = fetchMock;

      const first = await client.requestResponse("/api/download");
      const second = await client.requestResponse("/api/download");

      assert.deepEqual([first.status, second.status], [403, 403]);
      assert.deepEqual(onWorkspaceTransition.mock.calls, [[target]]);
      assert.equal(fetchMock.mock.calls.length, recovery ? 3 : 2);
      assert.equal(port.recover.mock.calls.length, recovery ? 1 : 0);
      assert.equal(port.clearIfCurrent.mock.calls.length, 0);
    });
  }
}
