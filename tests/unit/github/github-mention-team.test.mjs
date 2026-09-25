import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

function loadTeamValidator(response, requests = []) {
  return importTestModule("src/lib/github-mention-team.ts", {
    "./github-http": {
      githubJson: async (url, options) => {
        requests.push({ url, options });
        return response;
      },
    },
    "./github-project-config": {
      validGitHubProjectOwner: (value) => typeof value === "string" && /^[A-Za-z0-9-]+$/u.test(value),
    },
  });
}

test("GitHub mention-team validation accepts a notifiable organization team", async () => {
  const requests = [];
  const model = await loadTeamValidator({
    slug: "founderops",
    name: "FounderOps",
    html_url: "https://github.com/orgs/findmydoc-platform/teams/founderops",
    notification_setting: "notifications_enabled",
  }, requests);

  const team = await model.validateGitHubMentionTeam("findmydoc-platform", "founderops", "installation-token");

  assert.deepEqual(team, {
    slug: "founderops",
    name: "FounderOps",
    url: "https://github.com/orgs/findmydoc-platform/teams/founderops",
    notificationsEnabled: true,
  });
  assert.equal(requests[0].url, "https://api.github.com/orgs/findmydoc-platform/teams/founderops");
  assert.equal(requests[0].options.operation, "read");
});

test("GitHub mention-team validation rejects invalid slugs and muted teams", async () => {
  const invalid = await loadTeamValidator({ notification_setting: "notifications_enabled" });
  assert.equal(invalid.validGitHubTeamSlug("Founder Ops"), false);
  await assert.rejects(
    () => invalid.validateGitHubMentionTeam("findmydoc-platform", "Founder Ops", "token"),
    /ungültig/u,
  );

  const muted = await loadTeamValidator({ notification_setting: "notifications_disabled" });
  await assert.rejects(
    () => muted.validateGitHubMentionTeam("findmydoc-platform", "founderops", "token"),
    /deaktiviert/u,
  );
});

test("configured mention teams fall back when GitHub no longer accepts the team", async () => {
  const valid = await importTestModule("src/lib/github-mention-team-config.ts", {
    "server-only": {},
    "./github-app": {
      getGitHubAppInstallationToken: async () => "installation-token",
    },
    "./github-mention-team": {
      validateGitHubMentionTeam: async () => ({ slug: "founderops" }),
    },
  });
  assert.deepEqual(
    await valid.resolveGitHubMentionTeam("findmydoc-platform", "founderops"),
    { organization: "findmydoc-platform", teamSlug: "founderops" },
  );

  const invalid = await importTestModule("src/lib/github-mention-team-config.ts", {
    "server-only": {},
    "./github-app": {
      getGitHubAppInstallationToken: async () => "installation-token",
    },
    "./github-mention-team": {
      validateGitHubMentionTeam: async () => {
        throw new Error("team notifications are disabled");
      },
    },
  });
  assert.equal(
    await invalid.resolveGitHubMentionTeam("findmydoc-platform", "founderops"),
    undefined,
  );
});
