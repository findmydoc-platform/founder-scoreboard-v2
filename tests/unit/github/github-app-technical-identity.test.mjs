import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { beforeEach, test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const githubJsonCalls = [];
let githubJsonImplementation = async () => {
  throw new Error("GitHub network access was not expected.");
};

const githubApp = await importTestModule("src/lib/github-app.ts", {
  "./github-http": {
    githubJson: async (...args) => {
      githubJsonCalls.push(args);
      return githubJsonImplementation(...args);
    },
  },
});

const validPrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
  format: "pem",
  type: "pkcs8",
}).toString();

beforeEach(() => {
  githubJsonCalls.length = 0;
  githubJsonImplementation = async () => {
    throw new Error("GitHub network access was not expected.");
  };
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

async function withGitHubAppEnvironment(overrides, run) {
  const names = [
    "GITHUB_APP_ID",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_PRIVATE_KEY_PATH",
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_INSTALLATION_ID = "456";
    for (const [name, value] of Object.entries(overrides)) process.env[name] = value;
    await run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function expectSafeConfigurationFailure(overrides, forbiddenText) {
  await withGitHubAppEnvironment(overrides, async () => {
    await assert.rejects(
      githubApp.getGitHubAppInstallationToken(),
      (error) => {
        assert.ok(error instanceof githubApp.GitHubAppConfigurationError);
        assert.equal(error.message.includes(forbiddenText), false);
        return true;
      },
    );
  });
}

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

test("missing GitHub private key files are classified without exposing their path", async () => {
  const missingPath = join(process.cwd(), "missing-github-app-private-key.pem");
  await expectSafeConfigurationFailure({ GITHUB_APP_PRIVATE_KEY_PATH: missingPath }, missingPath);
});

test("unreadable GitHub private key paths are classified without exposing their path", async () => {
  const unreadablePath = process.cwd();
  await expectSafeConfigurationFailure({ GITHUB_APP_PRIVATE_KEY_PATH: unreadablePath }, unreadablePath);
});

test("invalid GitHub private keys are classified without exposing their contents", async () => {
  const invalidKey = "not-a-private-key";
  await expectSafeConfigurationFailure({ GITHUB_APP_PRIVATE_KEY: invalidKey }, invalidKey);
});

test("GitHub App operational status classifies invalid runtime configuration without exposing it", async () => {
  const invalidKey = "not-a-private-key";

  await withGitHubAppEnvironment({ GITHUB_APP_PRIVATE_KEY: invalidKey }, async () => {
    const status = await githubApp.getGitHubAppOperationalStatus();
    assert.deepEqual(status, {
      available: false,
      state: "configuration_required",
      description: "Die serverseitige GitHub-App-Konfiguration ist unvollständig.",
      nextStep: "GitHub-App-ID, Installation und privaten Schlüssel in der Laufzeitkonfiguration prüfen.",
    });
    assert.equal(JSON.stringify(status).includes(invalidKey), false);
  });

  assert.equal(githubJsonCalls.length, 0);
});

test("GitHub App operational status verifies the installation with a read-only request", async () => {
  githubJsonImplementation = async () => ({ id: 456 });

  await withGitHubAppEnvironment({ GITHUB_APP_PRIVATE_KEY: validPrivateKey }, async () => {
    assert.deepEqual(await githubApp.getGitHubAppOperationalStatus(), {
      available: true,
      state: "ready",
      description: "Die GitHub App ist erreichbar und die Installation ist verfügbar.",
      nextStep: "",
    });
  });

  assert.equal(githubJsonCalls.length, 1);
  assert.equal(githubJsonCalls[0][0], "https://api.github.com/app/installations/456");
  assert.equal(githubJsonCalls[0][1].method, "GET");
  assert.equal(githubJsonCalls[0][1].operation, "read");
  assert.ok(githubJsonCalls[0][1].signal instanceof AbortSignal);
});

test("GitHub App operational status aborts a stalled read and returns a safe failure", async () => {
  let aborted = false;
  githubJsonImplementation = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      aborted = true;
      reject(new Error("token=secret /private/path stalled"));
    }, { once: true });
  });

  await withGitHubAppEnvironment({ GITHUB_APP_PRIVATE_KEY: validPrivateKey }, async () => {
    assert.deepEqual(await githubApp.getGitHubAppOperationalStatus({ timeoutMs: 1 }), {
      available: false,
      state: "unavailable",
      description: "Die GitHub-App-Installation ist momentan nicht erreichbar.",
      nextStep: "Installation, Berechtigungen und GitHub-Verfügbarkeit prüfen.",
    });
  });

  assert.equal(aborted, true);
});
