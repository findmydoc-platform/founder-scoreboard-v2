import assert from "node:assert/strict";
import { test } from "vitest";

import { importTestModule } from "../../helpers/vitest-module.mjs";

const githubApp = await importTestModule("src/lib/github-app.ts");

test("OAuth state HMAC validates generated state and rejects a modified signature", () => {
  const previousKey = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  process.env.GITHUB_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

  try {
    const state = githubApp.createGitHubAppOAuthState({ userId: "user-1", profileId: "profile-1", next: "/team" });
    assert.equal(githubApp.verifyGitHubAppOAuthState(state).profileId, "profile-1");

    const [payload, signature] = state.split(".");
    const changedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    assert.throws(() => githubApp.verifyGitHubAppOAuthState(`${payload}.${changedSignature}`));
  } finally {
    if (previousKey === undefined) delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    else process.env.GITHUB_TOKEN_ENCRYPTION_KEY = previousKey;
  }
});
