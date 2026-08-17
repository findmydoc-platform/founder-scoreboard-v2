import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const projectFieldContext = await loadTranspiledModule("src/lib/github-sync/project-field-context.ts");

function projectValidationData(overrides = {}) {
  return {
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
  };
}

const projectConfig = {
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
};

test("GitHub Project validation requires all repositories and expected field types", async () => {
  const loadValidation = (data) => loadTranspiledModule("src/lib/github-project.ts", {
    "./github-graphql": { githubGraphql: async () => data },
    "./github-project-config": projectConfig,
  });
  const githubProject = await loadValidation(projectValidationData());
  const result = await githubProject.validateFounderOpsGitHubProject("findmydoc-platform", 21, "token");
  assert.equal(result.id, "project-21");
  assert.equal(result.repositories.length, 3);

  const missingRepository = await loadValidation(projectValidationData({
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
});

function supabaseFixture() {
  return {
    from(table) {
      if (table !== "projects") throw new Error(`Unexpected table: ${table}`);
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => ({
          data: {
            github_project_owner: "findmydoc-platform",
            github_project_number: 21,
          },
          error: null,
        }),
      };
      return builder;
    },
  };
}

function fieldContext() {
  return {
    organization: {
      projectV2: {
        id: "project-21",
        closed: false,
        fields: {
          nodes: [{
            id: "field-status",
            name: "Status",
            dataType: "SINGLE_SELECT",
            options: [{ id: "status-todo", name: "Todo" }],
          }],
        },
      },
      issueFields: { nodes: [] },
    },
    node: {
      id: "item-1",
      project: { id: "project-21" },
      content: { id: "issue-76", issueFieldValues: { nodes: [] } },
      fieldValues: {
        nodes: [{ field: { id: "field-status", name: "Status" }, optionId: "status-todo" }],
      },
    },
  };
}

const task = {
  status: "Offen",
  taskType: "sub_issue",
  sprintId: "",
  deadline: "",
  evidenceLink: "",
  hours: 0,
  priority: "P4",
  startDate: "",
  workstream: "",
};

async function loadProjectProjection(githubGraphql) {
  return loadTranspiledModule("src/lib/github-sync/project-projection.ts", {
    "../github-graphql": { githubGraphql },
    "../github-project-config": projectConfig,
    "../github-repositories": {
      splitGitHubRepository: (repository) => {
        const [owner, repo] = repository.split("/");
        return { owner, repo, repository };
      },
    },
    "./project-field-context": projectFieldContext,
  });
}

function projectInput() {
  return {
    supabase: supabaseFixture(),
    task,
    issueNumber: 76,
    repository: "findmydoc-platform/management",
    token: "token",
  };
}

test("existing Project membership is observed without mutation", async () => {
  let mutations = 0;
  const project = await loadProjectProjection(async ({ query }) => {
    if (query.includes("FounderOpsProjectMembership")) {
      return {
        organization: { projectV2: { id: "project-21", closed: false } },
        repository: {
          issue: {
            id: "issue-76",
            projectItems: { nodes: [{ id: "item-1", project: { id: "project-21" } }] },
          },
        },
      };
    }
    if (query.includes("FounderOpsProjectFields")) return fieldContext();
    mutations += 1;
    throw new Error("mutation must not run");
  });

  const result = await project.projectTaskToFounderOpsGitHubProject(projectInput());
  assert.deepEqual(result, { changes: [], warnings: [] });
  assert.equal(mutations, 0);
});

test("archived Project membership is immediately restored", async () => {
  const mutations = [];
  const project = await loadProjectProjection(async ({ query, variables }) => {
    if (query.includes("FounderOpsProjectMembership")) {
      return {
        organization: { projectV2: { id: "project-21", closed: false } },
        repository: {
          issue: {
            id: "issue-76",
            projectItems: { nodes: [{ id: "item-1", isArchived: true, project: { id: "project-21" } }] },
          },
        },
      };
    }
    if (query.includes("FounderOpsUnarchiveProjectItem")) {
      mutations.push(variables);
      return { unarchiveProjectV2Item: { item: { id: "item-1" } } };
    }
    if (query.includes("FounderOpsProjectFields")) return fieldContext();
    throw new Error("Unexpected GraphQL operation.");
  });

  const result = await project.projectTaskToFounderOpsGitHubProject(projectInput());
  assert.deepEqual(result, { changes: [], warnings: [] });
  assert.deepEqual(mutations, [{ projectId: "project-21", itemId: "item-1" }]);
});

test("missing Project membership is added once and a lost response is reconciled on replay", async () => {
  let membershipExists = false;
  let mutationCalls = 0;
  const project = await loadProjectProjection(async ({ query }) => {
    if (query.includes("FounderOpsProjectMembership")) {
      return {
        organization: { projectV2: { id: "project-21", closed: false } },
        repository: {
          issue: {
            id: "issue-76",
            projectItems: {
              nodes: membershipExists
                ? [{ id: "item-1", project: { id: "project-21" } }]
                : [],
            },
          },
        },
      };
    }
    if (query.includes("FounderOpsAddProjectItem")) {
      mutationCalls += 1;
      membershipExists = true;
      throw new Error("response lost after GitHub added the item");
    }
    if (query.includes("FounderOpsProjectFields")) return fieldContext();
    throw new Error("Unexpected GraphQL operation.");
  });

  await assert.rejects(
    () => project.projectTaskToFounderOpsGitHubProject(projectInput()),
    /response lost/,
  );
  const replayed = await project.projectTaskToFounderOpsGitHubProject(projectInput());
  assert.deepEqual(replayed, { changes: [], warnings: [] });
  assert.equal(mutationCalls, 1);
});

test("missing or inaccessible Project is a hard membership error", async () => {
  const project = await loadProjectProjection(async ({ query }) => {
    if (query.includes("FounderOpsProjectMembership")) {
      return {
        organization: { projectV2: null },
        repository: { issue: { id: "issue-76", projectItems: { nodes: [] } } },
      };
    }
    throw new Error("Unexpected GraphQL operation.");
  });
  await assert.rejects(
    () => project.projectTaskToFounderOpsGitHubProject(projectInput()),
    /nicht gefunden oder ist für die App nicht erreichbar/,
  );
});
