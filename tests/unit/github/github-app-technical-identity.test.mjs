import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { afterEach, beforeEach, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const githubJsonCalls = [];
let githubJsonImplementation = async () => { throw new Error("Unexpected synthetic GitHub request."); };
const githubApp = await import("../../../src/lib/github-app-errors.ts");
const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
const installation = () => authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "github.issue.read", target: { repositories: ["findmydoc-platform/management"] } });
const operationalStatus = (options = {}) => authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "github.installation.status", ...options });

const validPrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
  format: "pem",
  type: "pkcs8",
}).toString();

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

beforeEach(() => {
  githubJsonCalls.length = 0;
  vi.stubGlobal("fetch", async (url, options) => {
    githubJsonCalls.push([String(url), options]);
    return Response.json(await githubJsonImplementation(url, options));
  });
  githubJsonImplementation = async () => {
    throw new Error("GitHub network access was not expected.");
  };
});

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
      installation(),
      (error) => {
        assert.ok(error instanceof githubApp.GitHubAppConfigurationError);
        assert.equal(error.message.includes(forbiddenText), false);
        return true;
      },
    );
  });
}

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
    const status = await operationalStatus();
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
    assert.deepEqual(await operationalStatus(), {
      available: true,
      state: "ready",
      description: "Die GitHub App ist erreichbar und die Installation ist verfügbar.",
      nextStep: "",
    });
  });

  assert.equal(githubJsonCalls.length, 1);
  assert.equal(githubJsonCalls[0][0], "https://api.github.com/app/installations/456");
  assert.equal(githubJsonCalls[0][1].method, "GET");
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
    vi.useFakeTimers();
    const pending = operationalStatus();
    await vi.advanceTimersByTimeAsync(4_000);
    assert.deepEqual(await pending, {
      available: false,
      state: "unavailable",
      description: "Die GitHub-App-Installation ist momentan nicht erreichbar.",
      nextStep: "Installation, Berechtigungen und GitHub-Verfügbarkeit prüfen.",
    });
  });

  assert.equal(aborted, true);
});
