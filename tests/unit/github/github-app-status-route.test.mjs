import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const route = await importTestModule("src/app/api/github-app/status/route.ts", {
  "next/server": {
    NextResponse: { json: (body, init) => Response.json(body, init) },
  },
  "@/lib/api-response": {
    requireApiContext: async (_request, authorize) => {
      const permission = await authorize();
      return {
        ok: true,
        permission,
        supabase: {},
      };
    },
  },
  "@/lib/authz": {
    requireTeamMember: async () => ({ profile: { id: "profile-1" } }),
  },
  "@/lib/github-app": {
    getGitHubAppOperationalStatus: async () => ({
      available: false,
      state: "unavailable",
      description: "safe",
      nextStep: "safe",
    }),
    getGitHubUserConnectionStatus: async () => ({ connected: true, needsReconnect: false, expiresAt: null }),
  },
  "@/lib/github-comment-delivery": {
    countWaitingGitHubCommentsForAuthor: async () => 2,
  },
});

test("GitHub App status route preserves its browser contract through the shared operational status", async () => {
  const response = await route.GET(new Request("http://localhost/api/github-app/status"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    installation: { available: false },
    user: { connected: true, needsReconnect: false, expiresAt: null },
    waitingCommentCount: 2,
  });
});
