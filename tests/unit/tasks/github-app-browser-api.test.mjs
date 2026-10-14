import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const githubAppBrowserApi = await importTestModule("src/features/tasks/model/github-app-browser-api.ts");

test("a GitHub status network failure degrades to an unavailable browser snapshot", async () => {
  const snapshot = await githubAppBrowserApi.loadGitHubAppBrowserSnapshot({
    requestJson: async () => {
      throw new Error("network unavailable");
    },
  });

  assert.deepEqual(snapshot, {
    githubInstallationAvailable: false,
    githubUserConnected: false,
    waitingGitHubCommentCount: 0,
  });
});
