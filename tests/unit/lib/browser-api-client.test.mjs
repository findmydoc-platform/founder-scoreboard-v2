import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const originalFetch = globalThis.fetch;
const browserApiModule = await importTestModule("src/lib/browser-api-client.ts");

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function sessionPort({
  recovery = {
    kind: "refreshed",
    session: { accessToken: "refreshed-token", userId: "user-a" },
  },
  snapshot = { accessToken: "current-token", userId: "user-a" },
} = {}) {
  return {
    current: vi.fn().mockResolvedValue(snapshot),
    recover: vi.fn().mockResolvedValue(recovery),
    clearIfCurrent: vi.fn().mockResolvedValue(undefined),
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("a review mutation sends the browser credentials returned by the session port", async () => {
  const session = sessionPort({ snapshot: { accessToken: "fresh-token", userId: "user-a" } });
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ task: { id: "task-1" }, review: { id: "review-1" } }));
  globalThis.fetch = fetchMock;

  await apiClient.requestJson("/api/tasks/task-1/review", {
    method: "POST",
    json: { decision: "accepted" },
  });

  assert.equal(session.current.mock.calls.length, 1);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(new Headers(fetchMock.mock.calls[0][1].headers).get("authorization"), "Bearer fresh-token");
});

test("a marked review 401 refreshes and replays the identical JSON mutation once", async () => {
  const session = sessionPort();
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      code: "session_invalid_before_effect",
      error: "Anmeldung ungültig oder abgelaufen.",
    }, 401))
    .mockResolvedValueOnce(jsonResponse({
      task: { id: "task-1" },
      review: { id: "review-1" },
    }));
  globalThis.fetch = fetchMock;

  const payload = { decision: "accepted" };
  const result = await apiClient.requestJson("/api/tasks/task-1/review", {
    method: "POST",
    json: payload,
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.review.id, "review-1");
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(session.recover.mock.calls.length, 1);
  assert.deepEqual(session.recover.mock.calls[0][0], { accessToken: "current-token", userId: "user-a" });
  assert.equal(new Headers(fetchMock.mock.calls[0][1].headers).get("authorization"), "Bearer current-token");
  assert.equal(new Headers(fetchMock.mock.calls[1][1].headers).get("authorization"), "Bearer refreshed-token");
  assert.equal(fetchMock.mock.calls[0][1].body, JSON.stringify(payload));
  assert.equal(fetchMock.mock.calls[1][1].body, JSON.stringify(payload));
});

test("a second marked 401 clears the local session without a third request", async () => {
  const session = sessionPort();
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  }, 401));
  globalThis.fetch = fetchMock;

  const result = await apiClient.requestJson("/api/tasks/task-1/review", {
    method: "POST",
    json: { decision: "accepted" },
  });

  assert.equal(result.response.status, 401);
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.deepEqual(session.clearIfCurrent.mock.calls, [[{ accessToken: "refreshed-token", userId: "user-a" }]]);
});

test("a transient refresh failure returns the original marked 401 without clearing the session", async () => {
  const session = sessionPort({ recovery: { kind: "temporarily_unavailable" } });
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  }, 401));
  globalThis.fetch = fetchMock;

  const result = await apiClient.requestJson("/api/tasks/task-1/review", {
    method: "POST",
    json: { decision: "accepted" },
  });

  assert.equal(result.response.status, 401);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(session.clearIfCurrent.mock.calls.length, 0);
});

test("a session replaced by another user is never used to replay the request", async () => {
  const session = sessionPort({ recovery: { kind: "superseded" } });
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  }, 401));
  globalThis.fetch = fetchMock;

  const result = await apiClient.requestJson("/api/tasks/task-1/review", {
    method: "POST",
    json: { decision: "accepted" },
  });

  assert.equal(result.response.status, 401);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(session.clearIfCurrent.mock.calls.length, 0);
});

test("an unmarked upstream 401 does not alter the browser session", async () => {
  const session = sessionPort();
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "Upstream request failed: 401" }, 401));
  globalThis.fetch = fetchMock;

  const result = await apiClient.requestJson("/api/example-upstream");

  assert.equal(result.response.status, 401);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(session.recover.mock.calls.length, 0);
});

test("an upstream blob 401 does not alter the browser session", async () => {
  const session = sessionPort();
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "GitHub-Anhang konnte nicht geladen werden: 401" }, 401));
  globalThis.fetch = fetchMock;

  const result = await apiClient.requestBlob("/api/github-assets?url=attachment");

  assert.equal(result.response.status, 401);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(session.recover.mock.calls.length, 0);
});

test("a marked application-session 401 from a GET replays once", async () => {
  const session = sessionPort();
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      code: "session_invalid_before_effect",
      error: "Anmeldung ungültig oder abgelaufen.",
    }, 401))
    .mockResolvedValueOnce(new Response("asset", { status: 200 }));
  globalThis.fetch = fetchMock;

  const result = await apiClient.requestBlob("/api/github-assets?url=attachment");

  assert.equal(result.response.status, 200);
  assert.equal(await result.blob.text(), "asset");
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(session.recover.mock.calls.length, 1);
});

test("a non-JSON blob mutation is never replayed", async () => {
  const session = sessionPort();
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  }, 401));
  globalThis.fetch = fetchMock;

  const result = await apiClient.requestBlob("/api/export", { method: "POST" });

  assert.equal(result.response.status, 401);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(session.recover.mock.calls.length, 0);
});

test("a no-body JSON-client mutation is never replayed", async () => {
  const session = sessionPort();
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  }, 401));
  globalThis.fetch = fetchMock;

  const result = await apiClient.requestJson("/api/team/platform-releases/v1/releases/v1.2.3/seen", {
    method: "POST",
  });

  assert.equal(result.response.status, 401);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(session.recover.mock.calls.length, 0);
});

test("json undefined does not make a mutation replayable", async () => {
  const session = sessionPort();
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  }, 401));
  globalThis.fetch = fetchMock;

  await apiClient.requestJson("/api/example", { method: "DELETE", json: undefined });

  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(session.recover.mock.calls.length, 0);
});

test("a form request is never replayed", async () => {
  const session = sessionPort();
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  }, 401));
  globalThis.fetch = fetchMock;

  const result = await apiClient.requestForm("/api/upload", new FormData());

  assert.equal(result.response.status, 401);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(session.recover.mock.calls.length, 0);
});

test("a caller-provided authorization header is neither replaced nor connected to the browser session", async () => {
  const session = sessionPort();
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  }, 401));
  globalThis.fetch = fetchMock;

  const result = await apiClient.requestJson("/api/tasks/task-1/review", {
    method: "POST",
    headers: { authorization: "Bearer caller-token" },
    json: { decision: "accepted" },
  });

  assert.equal(result.response.status, 401);
  assert.equal(session.current.mock.calls.length, 0);
  assert.equal(session.recover.mock.calls.length, 0);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(new Headers(fetchMock.mock.calls[0][1].headers).get("authorization"), "Bearer caller-token");
});
