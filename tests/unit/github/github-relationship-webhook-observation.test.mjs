import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

let graphqlData;
let dependencies = [];
let dependencyUrl = "";

const allowedRepositories = new Set([
  "findmydoc-platform/management",
  "findmydoc-platform/website",
]);

const observation = await importTestModule("src/lib/github-sync/relationship-observation.ts", {
  "server-only": {},
  "../github": {
    listGitHubIssueBlockedBy: async (_issueNumber, _token, repository) => {
      dependencyUrl = `${repository}/issues/17/dependencies/blocked_by`;
      return dependencies;
    },
  },
  "../github-graphql": {
    githubGraphql: async () => graphqlData,
  },
  "../github-repositories": {
    normalizeGitHubRepository: (value) => allowedRepositories.has(value) ? value : null,
    splitGitHubRepository: (value) => {
      assert.equal(allowedRepositories.has(value), true);
      const [owner, repo] = value.split("/");
      return { owner, repo, repository: value };
    },
  },
});

test("Sub-Issue observations use the current parent instead of the webhook action", async () => {
  graphqlData = {
    repository: {
      issue: {
        id: "I_child",
        number: 18,
        repository: { nameWithOwner: "findmydoc-platform/website" },
        parent: {
          number: 17,
          repository: { nameWithOwner: "findmydoc-platform/management" },
        },
      },
    },
  };
  const input = {
    childRepositoryFullName: "findmydoc-platform/website",
    childIssueNumber: 18,
    childIssueNodeId: "I_child",
    token: "token",
  };
  assert.deepEqual(await observation.loadGitHubSubIssueParentObservation(input), {
    repositoryFullName: "findmydoc-platform/management",
    issueNumber: 17,
  });

  graphqlData = {
    ...graphqlData,
    repository: { issue: { ...graphqlData.repository.issue, parent: null } },
  };
  assert.equal(await observation.loadGitHubSubIssueParentObservation(input), null);
});

test("dependency observations match both the current Issue number and repository", async () => {
  dependencies = [{
    id: 202,
    number: 18,
    repositoryFullName: "findmydoc-platform/website",
  }];
  const input = {
    blockedRepositoryFullName: "findmydoc-platform/management",
    blockedIssueNumber: 17,
    blockingRepositoryFullName: "findmydoc-platform/website",
    blockingIssueNumber: 18,
    token: "token",
  };
  assert.equal(await observation.loadGitHubDependencyObservation(input), true);
  assert.match(dependencyUrl, /management\/issues\/17\/dependencies\/blocked_by/);

  dependencies = [{
    ...dependencies[0],
    repositoryFullName: "findmydoc-platform/management",
  }];
  assert.equal(await observation.loadGitHubDependencyObservation(input), false);
});
