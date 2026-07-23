import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

function projectValidationResult(overrides = {}) {
  return {
    data: {
      organization: {
        projectV2: {
          id: "project-21",
          number: 21,
          title: "FounderOps",
          closed: false,
          url: "https://github.com/orgs/findmydoc-platform/projects/21",
          repositories: {
            totalCount: 3,
            nodes: [
              { nameWithOwner: "findmydoc-platform/management" },
              { nameWithOwner: "findmydoc-platform/website" },
              { nameWithOwner: "findmydoc-platform/clinic-dashboard" },
            ],
          },
          fields: {
            nodes: [
              { name: "Status", dataType: "SINGLE_SELECT" },
              { name: "Sprint", dataType: "ITERATION" },
              { name: "Workstream", dataType: "SINGLE_SELECT" },
              { name: "Estimate hours", dataType: "NUMBER" },
              { name: "Evidence URL", dataType: "TEXT" },
              { name: "Priority", dataType: "SINGLE_SELECT" },
              { name: "Effort", dataType: "SINGLE_SELECT" },
              { name: "Start date", dataType: "DATE" },
              { name: "Target date", dataType: "DATE" },
            ],
          },
          ...overrides,
        },
      },
    },
  };
}

async function loadProjectModule(handler) {
  return loadTranspiledModule("src/lib/github-project.ts", {
    "./github-http": { githubJson: handler },
    "./github-project-config": {
      FOUNDEROPS_GITHUB_PROJECT_FIELDS: [
        { name: "Status", dataType: "SINGLE_SELECT" },
        { name: "Sprint", dataType: "ITERATION" },
        { name: "Workstream", dataType: "SINGLE_SELECT" },
        { name: "Estimate hours", dataType: "NUMBER" },
        { name: "Evidence URL", dataType: "TEXT" },
        { name: "Priority", dataType: "SINGLE_SELECT" },
        { name: "Effort", dataType: "SINGLE_SELECT" },
        { name: "Start date", dataType: "DATE" },
        { name: "Target date", dataType: "DATE" },
      ],
      FOUNDEROPS_GITHUB_REPOSITORIES: [
        "findmydoc-platform/management",
        "findmydoc-platform/website",
        "findmydoc-platform/clinic-dashboard",
      ],
      validGitHubProjectOwner: (value) => typeof value === "string" && Boolean(value),
      validGitHubProjectNumber: (value) => Number.isInteger(value) && value > 0,
    },
    "./github-repositories": {
      splitGitHubRepository: (repository) => {
        const [owner, repo] = repository.split("/");
        return { owner, repo, repository };
      },
    },
  });
}

test("GitHub Project validation requires all repositories and expected field types", async () => {
  const githubProject = await loadProjectModule(async () => projectValidationResult());
  const result = await githubProject.validateFounderOpsGitHubProject("findmydoc-platform", 21, "token");

  assert.equal(result.id, "project-21");
  assert.equal(result.repositories.length, 3);

  const missingRepository = await loadProjectModule(async () => projectValidationResult({
    repositories: {
      totalCount: 2,
      nodes: [
        { nameWithOwner: "findmydoc-platform/management" },
        { nameWithOwner: "findmydoc-platform/website" },
      ],
    },
  }));
  await assert.rejects(
    () => missingRepository.validateFounderOpsGitHubProject("findmydoc-platform", 21, "token"),
    /clinic-dashboard/,
  );

  const wrongFieldType = await loadProjectModule(async () => {
    const result = projectValidationResult();
    result.data.organization.projectV2.fields.nodes.find((field) => field.name === "Sprint").dataType = "TEXT";
    return result;
  });
  await assert.rejects(
    () => wrongFieldType.validateFounderOpsGitHubProject("findmydoc-platform", 21, "token"),
    /Sprint \(ITERATION\)/,
  );
});

test("existing Project membership is observed without mutation", async () => {
  let mutations = 0;
  const githubProject = await loadProjectModule(async (_url, options) => {
    if (options.body.query.includes("FounderOpsProjectMembership")) {
      return {
        data: {
          organization: { projectV2: { id: "project-21", closed: false } },
          repository: { issue: { id: "issue-76", projectItems: { nodes: [{ id: "item-1", project: { id: "project-21" } }] } } },
        },
      };
    }
    mutations += 1;
    throw new Error("mutation must not run");
  });

  const result = await githubProject.ensureFounderOpsGitHubProjectItem({
    issueNumber: 76,
    projectNumber: 21,
    projectOwner: "findmydoc-platform",
    repository: "findmydoc-platform/management",
    token: "token",
  });

  assert.equal(result.added, false);
  assert.equal(mutations, 0);
});

test("missing Project membership can be observed without mutation", async () => {
  let mutations = 0;
  const githubProject = await loadProjectModule(async (_url, options) => {
    if (options.body.query.includes("FounderOpsProjectMembership")) {
      return {
        data: {
          organization: { projectV2: { id: "project-21", closed: false } },
          repository: { issue: { id: "issue-76", projectItems: { nodes: [] } } },
        },
      };
    }
    mutations += 1;
    throw new Error("mutation must not run");
  });

  const result = await githubProject.observeFounderOpsGitHubProjectItem({
    issueNumber: 76,
    projectNumber: 21,
    projectOwner: "findmydoc-platform",
    repository: "findmydoc-platform/management",
    token: "token",
  });

  assert.deepEqual(result, {
    issueId: "issue-76",
    itemId: null,
    projectId: "project-21",
  });
  assert.equal(mutations, 0);
});

test("missing Project membership is added once and a lost response is reconciled on replay", async () => {
  let membershipExists = false;
  let mutationCalls = 0;
  const githubProject = await loadProjectModule(async (_url, options) => {
    if (options.body.query.includes("FounderOpsProjectMembership")) {
      return {
        data: {
          organization: { projectV2: { id: "project-21", closed: false } },
          repository: {
            issue: {
              id: "issue-76",
              projectItems: { nodes: membershipExists ? [{ id: "item-1", project: { id: "project-21" } }] : [] },
            },
          },
        },
      };
    }
    mutationCalls += 1;
    membershipExists = true;
    throw new Error("response lost after GitHub added the item");
  });

  const input = {
    issueNumber: 76,
    projectNumber: 21,
    projectOwner: "findmydoc-platform",
    repository: "findmydoc-platform/management",
    token: "token",
  };
  await assert.rejects(() => githubProject.ensureFounderOpsGitHubProjectItem(input), /response lost/);
  const replayed = await githubProject.ensureFounderOpsGitHubProjectItem(input);

  assert.equal(replayed.added, false);
  assert.equal(mutationCalls, 1);
});

test("missing or inaccessible Project is a hard membership error", async () => {
  const githubProject = await loadProjectModule(async () => ({
    data: {
      organization: { projectV2: null },
      repository: { issue: { id: "issue-76", projectItems: { nodes: [] } } },
    },
  }));

  await assert.rejects(() => githubProject.ensureFounderOpsGitHubProjectItem({
    issueNumber: 76,
    projectNumber: 999,
    projectOwner: "findmydoc-platform",
    repository: "findmydoc-platform/management",
    token: "token",
  }), /nicht gefunden oder ist für die App nicht erreichbar/);
});
