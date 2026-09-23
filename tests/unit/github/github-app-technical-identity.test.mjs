import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const githubApp = await importTestModule("src/lib/github-app.ts", {
  "./github-http": {
    githubJson: async () => {
      throw new Error("GitHub network access was not expected.");
    },
  },
});

function serviceSupabase({ configuredLogin = "sebastian", tokenLogin = configuredLogin } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const query = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() {
          if (table === "profiles") return { data: { github_login: configuredLogin }, error: null };
          if (table === "github_app_user_tokens") {
            return {
              data: {
                profile_id: "profile-1",
                github_login: tokenLogin,
                encrypted_access_token: "unused",
                encrypted_refresh_token: null,
                access_token_expires_at: "2999-01-01T00:00:00.000Z",
                refresh_token_expires_at: null,
                connected_at: "2026-09-22T00:00:00.000Z",
                refreshed_at: null,
                last_used_at: null,
                revoked_at: null,
                last_error: null,
              },
              error: null,
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      };
      return query;
    },
  };
}

const browserSafeProfile = {
  id: "profile-1",
  name: "Sebastian",
  platformRole: "founder",
  githubLogin: "",
};

test("GitHub connection status resolves the technical login only through the service client", async () => {
  const supabase = serviceSupabase();

  const status = await githubApp.getGitHubUserConnectionStatus(supabase, browserSafeProfile);

  assert.deepEqual(status, {
    connected: true,
    needsReconnect: false,
    expiresAt: "2999-01-01T00:00:00.000Z",
  });
  assert.deepEqual(supabase.calls, ["profiles", "github_app_user_tokens"]);
  assert.equal("githubLogin" in status, false);
});

test("GitHub user tokens remain bound to the centrally configured login", async () => {
  const supabase = serviceSupabase({ configuredLogin: "sebastian", tokenLogin: "another-user" });

  await assert.rejects(
    githubApp.getGitHubUserTokenForProfile(supabase, browserSafeProfile),
    /passt nicht zum angemeldeten Teamprofil/,
  );
});

test("GitHub OAuth callback validation uses the centrally configured login", async () => {
  const supabase = serviceSupabase({ configuredLogin: "sebastian" });

  await assert.rejects(
    githubApp.storeGitHubAppUserToken({
      supabase,
      profile: browserSafeProfile,
      githubUser: { id: 42, login: "another-user" },
      token: { access_token: "unused" },
    }),
    /passt nicht zum angemeldeten Teamprofil/,
  );
});
