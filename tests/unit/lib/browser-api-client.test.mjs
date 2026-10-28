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
    session: { revision: "refreshed-token", userId: "user-a" },
  },
  snapshot = { revision: "current-token", userId: "user-a" },
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

for (const [code, target] of [
  ["workspace_link_required", "/auth/link-google"],
  ["workspace_google_login_required", "/auth/login?provider=google"],
]) {
  for (const kind of ["json", "form", "blob"]) {
    test(`${kind} requests navigate once for ${code} without replay or clearing the linking session`, async () => {
      const session = sessionPort();
      const onWorkspaceTransition = vi.fn();
      const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session, onWorkspaceTransition });
      const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ code }, 403));
      globalThis.fetch = fetchMock;
      const request = () => kind === "json"
        ? apiClient.requestJson("/api/tasks/task-1", { method: "POST", json: { title: "Test" } })
        : kind === "form"
          ? apiClient.requestForm("/api/tasks/task-1/attachments", new FormData())
          : apiClient.requestBlob("/api/export");

      const results = await Promise.all([request(), request()]);

      assert.deepEqual(results.map(result => result.response.status), [403, 403]);
      assert.deepEqual(onWorkspaceTransition.mock.calls, [[target]]);
      assert.equal(fetchMock.mock.calls.length, 2);
      assert.equal(session.recover.mock.calls.length, 0);
      assert.equal(session.clearIfCurrent.mock.calls.length, 0);
    });
  }
}

test("a Workspace dependency outage does not navigate to Google login", async () => {
  const session = sessionPort();
  const onWorkspaceTransition = vi.fn();
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session, onWorkspaceTransition });
  globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ code: "workspace_access_unavailable" }, 503));

  const result = await apiClient.requestJson("/api/tasks/task-1");

  assert.equal(result.response.status, 503);
  assert.equal(onWorkspaceTransition.mock.calls.length, 0);
  assert.equal(session.recover.mock.calls.length, 0);
});

test("a review mutation uses browser cookie transport without an authorization token", async () => {
  const session = sessionPort({ snapshot: { revision: "fresh-token", userId: "user-a" } });
  const apiClient = browserApiModule.createBrowserApiClient({ sessionPort: session });
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ task: { id: "task-1" }, review: { id: "review-1" } }));
  globalThis.fetch = fetchMock;

  await apiClient.requestJson("/api/tasks/task-1/review", {
    method: "POST",
    json: { decision: "accepted" },
  });

  assert.equal(session.current.mock.calls.length, 1);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(new Headers(fetchMock.mock.calls[0][1].headers).get("authorization"), null);
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
  assert.deepEqual(session.recover.mock.calls[0][0], { revision: "current-token", userId: "user-a" });
  assert.equal(new Headers(fetchMock.mock.calls[0][1].headers).get("authorization"), null);
  assert.equal(new Headers(fetchMock.mock.calls[1][1].headers).get("authorization"), null);
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
  assert.deepEqual(session.clearIfCurrent.mock.calls, [[{ revision: "refreshed-token", userId: "user-a" }]]);
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

for (const replacement of [null,{userId:"user-b",revision:"old"},{userId:"user-a",revision:"new"}]) test(`multipart expected session rejects a replacement before dispatch (${JSON.stringify(replacement)})`,async()=>{
 let finish;const port=sessionPort();port.current=()=>new Promise(resolve=>{finish=resolve;});const client=browserApiModule.createBrowserApiClient({sessionPort:port});const fetchMock=vi.fn().mockResolvedValue(jsonResponse({markdown:"wrong-account"}));globalThis.fetch=fetchMock;const request=client.requestForm("/api/tasks/task/attachments",new FormData(),{expectedSession:{userId:"user-a",revision:"old"}});finish(replacement);const result=await request;assert.equal(result.response.status,409);assert.equal(result.body.code,"session_superseded");assert.equal(fetchMock.mock.calls.length,0);assert.equal(port.recover.mock.calls.length,0);
});
test("multipart expected session allows the same current authority without forwarding its metadata",async()=>{
 const port=sessionPort({snapshot:{userId:"user-a",revision:"same"}}),client=browserApiModule.createBrowserApiClient({sessionPort:port});const fetchMock=vi.fn().mockResolvedValue(jsonResponse({markdown:"confirmed"}));globalThis.fetch=fetchMock;const result=await client.requestForm("/api/tasks/task/attachments",new FormData(),{expectedSession:{userId:"user-a",revision:"same"}});assert.equal(result.response.status,200);assert.equal(fetchMock.mock.calls.length,1);assert.equal(fetchMock.mock.calls[0][1].expectedSession,undefined);assert.equal(port.recover.mock.calls.length,0);
});

test("multipart expected authority revoked after current() resolution sends no bytes",async()=>{
 const snapshot={userId:"user-a",revision:"same"};const port={...sessionPort({snapshot}),isCurrent:()=>false};const client=browserApiModule.createBrowserApiClient({sessionPort:port}),fetchMock=vi.fn();globalThis.fetch=fetchMock;const result=await client.requestForm("/api/tasks/task/attachments",new FormData(),{expectedSession:snapshot});assert.equal(result.body.code,"session_superseded");assert.equal(fetchMock.mock.calls.length,0);
});

for(const snapshot of [null,{userId:"other",revision:"new"},{userId:"user-a",revision:"unexpected-replacement"}])test(`bound JSON rejects ended or changed initial session ${JSON.stringify(snapshot)}`,async()=>{
 const port=sessionPort({snapshot}),api=browserApiModule.createBrowserApiClient({sessionPort:port});const fetch=vi.fn();globalThis.fetch=fetch;
 const result=await api.requestJson("/api/tasks/task-1/sync-github",{method:"POST",json:{createIfMissing:false},expectedSession:{userId:"user-a",revision:"current-token"}});
 assert.equal(result.response.status,409);assert.equal(result.body.code,"session_superseded");assert.equal(fetch.mock.calls.length,0);
});
test("bound JSON permits legitimate same-account before-effect recovery and strips its local binding",async()=>{
 const port=sessionPort(),api=browserApiModule.createBrowserApiClient({sessionPort:port});const fetch=vi.fn().mockResolvedValueOnce(jsonResponse({code:"session_invalid_before_effect"},401)).mockResolvedValueOnce(jsonResponse({ok:true}));globalThis.fetch=fetch;
 const result=await api.requestJson("/api/tasks/task-1/sync-github",{method:"POST",json:{createIfMissing:false},expectedSession:{userId:"user-a",revision:"current-token"}});
 assert.equal(result.response.status,200);assert.equal(fetch.mock.calls.length,2);assert.equal(fetch.mock.calls[0][1].body,fetch.mock.calls[1][1].body);assert.equal(Object.hasOwn(fetch.mock.calls[0][1],"expectedSession"),false);
});
test("bound JSON never replays under a replacement account returned during recovery",async()=>{
 const port=sessionPort({recovery:{kind:"refreshed",session:{userId:"other",revision:"other"}}}),api=browserApiModule.createBrowserApiClient({sessionPort:port});const fetch=vi.fn().mockResolvedValue(jsonResponse({code:"session_invalid_before_effect"},401));globalThis.fetch=fetch;
 const result=await api.requestJson("/api/tasks/task-1/sync-github",{method:"POST",json:{createIfMissing:false},expectedSession:{userId:"user-a",revision:"current-token"}});assert.equal(result.response.status,409);assert.equal(result.body.code,"session_superseded");assert.equal(fetch.mock.calls.length,1);
});

test("bound JSON rejects a recovered session that ended while recovery was held",async()=>{
 let finish;const port=sessionPort();port.recover=()=>new Promise(resolve=>{finish=resolve;});port.isCurrent=()=>false;const api=browserApiModule.createBrowserApiClient({sessionPort:port});const fetch=vi.fn().mockResolvedValue(jsonResponse({code:"session_invalid_before_effect"},401));globalThis.fetch=fetch;
 let alive=true;port.isCurrent=()=>alive;const writing=api.requestJson("/api/tasks/task-1/sync-github",{method:"POST",json:{createIfMissing:false},expectedSession:{userId:"user-a",revision:"current-token"}});await vi.waitFor(()=>assert.equal(typeof finish,"function"));alive=false;finish({kind:"refreshed",session:{userId:"user-a",revision:"refreshed-token"}});const result=await writing;assert.equal(result.response.status,409);assert.equal(result.body.code,"session_superseded");assert.equal(fetch.mock.calls.length,1);
});
