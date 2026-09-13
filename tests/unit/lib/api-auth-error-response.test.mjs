import assert from "node:assert/strict";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { beforeEach, test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

let getUserResult;

beforeEach(() => {
  getUserResult = {
    data: { user: null },
    error: new Error("expired token"),
  };
});

const { apiError, authzError } = await importTestModule("src/lib/api-response.ts", {
  "./supabase": { getServerSupabase: () => ({}) },
});

const authz = await importTestModule("src/lib/authz.ts", {
  "./local-development-auth": { isLocalLoginRequestAllowed: () => false },
  "./platform": { isOperationalLeadRole: () => false },
  "./supabase": {
    getSupabaseForToken: () => ({
      auth: {
        getUser: async () => getUserResult,
      },
    }),
    requiresSupabaseAuth: () => true,
  },
});

test("an invalid application session is marked for browser recovery", async () => {
  const permission = await authz.requirePlanningContributor({
    headers: new Headers({ authorization: "Bearer expired-token" }),
  });
  assert.deepEqual(permission, {
    ok: false,
    status: 401,
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  });

  const response = authzError(permission);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  });
});

test("only the authorization serializer emits the pre-effect marker", async () => {
  const response = apiError("Anmeldung ungültig oder abgelaufen.", 401);

  assert.deepEqual(await response.json(), {
    error: "Anmeldung ungültig oder abgelaufen.",
  });
});

test("authorization response fields cannot forge the pre-effect marker", async () => {
  const response = authzError(
    { ok: false, status: 401, error: "Anmeldung erforderlich." },
    { code: "session_invalid_before_effect", ok: false },
  );

  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Anmeldung erforderlich.",
  });
});

test("a retryable Supabase Auth outage is not marked as an invalid session", async () => {
  getUserResult = {
    data: { user: null },
    error: new AuthRetryableFetchError("Service temporarily unavailable", 503),
  };

  const permission = await authz.requirePlanningContributor({
    headers: new Headers({ authorization: "Bearer current-token" }),
  });

  assert.deepEqual(permission, {
    ok: false,
    status: 503,
    error: "Anmeldung konnte vorübergehend nicht geprüft werden.",
  });
  const response = authzError(permission);
  assert.deepEqual(await response.json(), {
    error: "Anmeldung konnte vorübergehend nicht geprüft werden.",
  });
});

function sessionSupabase({ profile = null, profileError = null } = {}) {
  const user = { id: "auth-user", user_metadata: {} };
  return {
    user,
    client: {
      auth: {
        getUser: async () => ({ data: { user }, error: null }),
      },
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return { data: profile, error: profileError };
          },
        };
      },
    },
  };
}

test("session authorization returns a valid mapped team profile", async () => {
  const fixture = sessionSupabase({
    profile: {
      id: "profile-1",
      name: "Delegate",
      platform_role: "deputy",
      github_login: "delegate",
    },
  });

  const result = await authz.requireTeamMemberForSession(fixture.client);

  assert.deepEqual(result, {
    ok: true,
    user: fixture.user,
    profile: {
      id: "profile-1",
      name: "Delegate",
      platformRole: "deputy",
      githubLogin: "delegate",
    },
  });
});

test("session authorization fails closed for an unmapped user", async () => {
  const fixture = sessionSupabase();

  const result = await authz.requireTeamMemberForSession(fixture.client);

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    error: "GitHub-User ist keinem Teamprofil zugeordnet.",
    user: fixture.user,
  });
});

test("session authorization fails closed when profile lookup is ambiguous", async () => {
  const fixture = sessionSupabase({ profileError: new Error("ambiguous") });

  const result = await authz.requireTeamMemberForSession(fixture.client);

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    error: "Teamprofil konnte nicht eindeutig geprüft werden.",
    user: fixture.user,
  });
});
