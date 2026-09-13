import assert from "node:assert/strict";
import { AuthRefreshDiscardedError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

function supabaseSession(accessToken, userId = "user-a") {
  return {
    access_token: accessToken,
    user: { id: userId, user_metadata: { user_name: "reviewer" } },
  };
}

async function loadAdapter({
  getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  refreshSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
} = {}) {
  const supabase = {
    auth: {
      getSession,
      refreshSession,
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  };
  const browserSessionModule = await importTestModule("src/lib/browser-session-adapter.ts", {
    "@/lib/supabase": { getBrowserSupabase: () => supabase },
  });
  return { adapter: browserSessionModule.createSupabaseBrowserSessionAdapter(), supabase };
}

test("current delegates token freshness to Supabase getSession", async () => {
  const getSession = vi.fn().mockResolvedValue({
    data: { session: supabaseSession("current-token") },
    error: null,
  });
  const refreshSession = vi.fn();
  const { adapter } = await loadAdapter({ getSession, refreshSession });

  const snapshot = await adapter.current();

  assert.deepEqual(snapshot, { accessToken: "current-token", userId: "user-a" });
  assert.equal(getSession.mock.calls.length, 1);
  assert.equal(refreshSession.mock.calls.length, 0);
});

test("recovery reuses a token that another request already rotated", async () => {
  const getSession = vi.fn().mockResolvedValue({
    data: { session: supabaseSession("already-rotated-token") },
    error: null,
  });
  const refreshSession = vi.fn();
  const { adapter, supabase } = await loadAdapter({ getSession, refreshSession });

  const recovery = await adapter.recover({ accessToken: "rejected-token", userId: "user-a" });

  assert.deepEqual(recovery, {
    kind: "refreshed",
    session: { accessToken: "already-rotated-token", userId: "user-a" },
  });
  assert.equal(refreshSession.mock.calls.length, 0);
  assert.equal(supabase.auth.signOut.mock.calls.length, 0);
});

test("recovery never reuses a session belonging to another user", async () => {
  const getSession = vi.fn().mockResolvedValue({
    data: { session: supabaseSession("other-token", "user-b") },
    error: null,
  });
  const refreshSession = vi.fn();
  const { adapter, supabase } = await loadAdapter({ getSession, refreshSession });

  const recovery = await adapter.recover({ accessToken: "rejected-token", userId: "user-a" });

  assert.deepEqual(recovery, { kind: "superseded" });
  assert.equal(refreshSession.mock.calls.length, 0);
  assert.equal(supabase.auth.signOut.mock.calls.length, 0);
});

test("recovery refreshes the rejected current token", async () => {
  const getSession = vi.fn().mockResolvedValue({
    data: { session: supabaseSession("rejected-token") },
    error: null,
  });
  const refreshSession = vi.fn().mockResolvedValue({
    data: { session: supabaseSession("fresh-token") },
    error: null,
  });
  const { adapter, supabase } = await loadAdapter({ getSession, refreshSession });

  const recovery = await adapter.recover({ accessToken: "rejected-token", userId: "user-a" });

  assert.deepEqual(recovery, {
    kind: "refreshed",
    session: { accessToken: "fresh-token", userId: "user-a" },
  });
  assert.equal(refreshSession.mock.calls.length, 1);
  assert.equal(supabase.auth.signOut.mock.calls.length, 0);
});

test("a retryable provider refresh error preserves the local session", async () => {
  const getSession = vi.fn().mockResolvedValue({
    data: { session: supabaseSession("rejected-token") },
    error: null,
  });
  const refreshSession = vi.fn().mockResolvedValue({
    data: { session: null },
    error: new AuthRetryableFetchError("Service temporarily unavailable", 503),
  });
  const { adapter, supabase } = await loadAdapter({ getSession, refreshSession });

  const recovery = await adapter.recover({ accessToken: "rejected-token", userId: "user-a" });

  assert.deepEqual(recovery, { kind: "temporarily_unavailable" });
  assert.equal(supabase.auth.signOut.mock.calls.length, 0);
});

test("a thrown provider refresh failure preserves the local session", async () => {
  const getSession = vi.fn().mockResolvedValue({
    data: { session: supabaseSession("rejected-token") },
    error: null,
  });
  const refreshSession = vi.fn().mockRejectedValue(new Error("network unavailable"));
  const { adapter, supabase } = await loadAdapter({ getSession, refreshSession });

  const recovery = await adapter.recover({ accessToken: "rejected-token", userId: "user-a" });

  assert.deepEqual(recovery, { kind: "temporarily_unavailable" });
  assert.equal(supabase.auth.signOut.mock.calls.length, 0);
});

test("a discarded refresh preserves the replacement session", async () => {
  const getSession = vi.fn().mockResolvedValue({
    data: { session: supabaseSession("rejected-token") },
    error: null,
  });
  const refreshSession = vi.fn().mockResolvedValue({
    data: { session: null },
    error: new AuthRefreshDiscardedError(),
  });
  const { adapter, supabase } = await loadAdapter({ getSession, refreshSession });

  const recovery = await adapter.recover({ accessToken: "rejected-token", userId: "user-a" });

  assert.deepEqual(recovery, { kind: "superseded" });
  assert.equal(supabase.auth.signOut.mock.calls.length, 0);
});

test("a permanently invalid refresh clears the local session", async () => {
  const getSession = vi.fn().mockResolvedValue({
    data: { session: supabaseSession("rejected-token") },
    error: null,
  });
  const refreshSession = vi.fn().mockResolvedValue({
    data: { session: null },
    error: new Error("Invalid Refresh Token"),
  });
  const { adapter, supabase } = await loadAdapter({ getSession, refreshSession });

  const recovery = await adapter.recover({ accessToken: "rejected-token", userId: "user-a" });

  assert.deepEqual(recovery, { kind: "unavailable" });
  assert.deepEqual(supabase.auth.signOut.mock.calls, [[{ scope: "local" }]]);
});

test("conditional cleanup preserves a newer token for the same user", async () => {
  const getSession = vi.fn().mockResolvedValue({
    data: { session: supabaseSession("newer-token") },
    error: null,
  });
  const { adapter, supabase } = await loadAdapter({ getSession });

  await adapter.clearIfCurrent({ accessToken: "rejected-token", userId: "user-a" });

  assert.equal(supabase.auth.signOut.mock.calls.length, 0);
});

test("conditional cleanup clears the unchanged rejected session", async () => {
  const getSession = vi.fn().mockResolvedValue({
    data: { session: supabaseSession("rejected-token") },
    error: null,
  });
  const { adapter, supabase } = await loadAdapter({ getSession });

  await adapter.clearIfCurrent({ accessToken: "rejected-token", userId: "user-a" });

  assert.deepEqual(supabase.auth.signOut.mock.calls, [[{ scope: "local" }]]);
});
