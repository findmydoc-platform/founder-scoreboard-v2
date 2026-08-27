import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

const projectFieldContext = await loadTranspiledModule("src/lib/github-sync/project-field-context.ts");

let observationData;

const observation = await loadTranspiledModule("src/lib/github-sync/project-observation.ts", {
  "server-only": {},
  "../github-graphql": { githubGraphql: async () => observationData },
  "../github-repositories": {
    normalizeGitHubRepository: (value) => value === "findmydoc-platform/management" ? value : null,
  },
  "./project-projection": {
    loadFounderOpsGitHubProjectSettings: async () => ({ owner: "findmydoc-platform", number: 21 }),
  },
  "./project-field-context": projectFieldContext,
});

function data(overrides = {}) {
  return {
    organization: {
      projectV2: {
        id: "PVT_project",
        closed: false,
        fields: {
          nodes: [
            {
              id: "PVTF_status",
              name: "Status",
              dataType: "SINGLE_SELECT",
              options: [{ id: "option-blocked", name: "Blocked" }],
            },
            {
              id: "PVTF_sprint",
              name: "Sprint",
              dataType: "ITERATION",
              configuration: {
                iterations: [{ id: "iteration-two", title: "Sprint 2", startDate: "2026-08-24" }],
                completedIterations: [],
              },
            },
          ],
        },
      },
      issueFields: { nodes: [] },
    },
    content: {
      id: "I_issue",
      number: 17,
      repository: { nameWithOwner: "findmydoc-platform/management" },
      issueFieldValues: { nodes: [] },
    },
    item: {
      id: "PVTI_item",
      updatedAt: "2026-08-16T12:01:00.000Z",
      isArchived: false,
      project: { id: "PVT_project" },
      content: { id: "I_issue" },
      fieldValues: {
        nodes: [
          { field: { id: "PVTF_status", name: "Status" }, optionId: "option-blocked" },
          { field: { id: "PVTF_sprint", name: "Sprint" }, iterationId: "iteration-two" },
        ],
      },
    },
    ...overrides,
  };
}

async function load(fieldNodeId) {
  return observation.loadGitHubPlanningProjectObservation({
    supabase: {},
    projectNodeId: "PVT_project",
    projectItemNodeId: "PVTI_item",
    contentNodeId: "I_issue",
    fieldNodeId,
    token: "token",
  });
}

test("Project observations reload stable Issue identity and the current field value", async () => {
  observationData = data();
  assert.deepEqual(await load("PVTF_status"), {
    repositoryFullName: "findmydoc-platform/management",
    issueNumber: 17,
    projectNodeId: "PVT_project",
    projectItemNodeId: "PVTI_item",
    projectItemActive: true,
    projectItemUpdatedAt: "2026-08-16T12:01:00.000Z",
    changedFieldName: "Status",
    changedFieldValue: "Blocked",
  });
  assert.deepEqual((await load("PVTF_sprint")).changedFieldValue, {
    title: "Sprint 2",
    startDate: "2026-08-24",
  });
});

test("deleted Project items still resolve through the durable content node", async () => {
  observationData = data({ item: null });
  const result = await load(null);
  assert.equal(result.repositoryFullName, "findmydoc-platform/management");
  assert.equal(result.issueNumber, 17);
  assert.equal(result.projectItemActive, false);
  assert.equal(result.projectItemUpdatedAt, null);
  assert.equal(result.changedFieldName, null);
});

test("Project observations reject a different configured Project or Issue", async () => {
  observationData = data({
    organization: {
      ...data().organization,
      projectV2: { ...data().organization.projectV2, id: "PVT_other" },
    },
  });
  await assert.rejects(() => load("PVTF_status"), /identity does not match/);
});

test("Issue field observations reload the current value by name without trusting payload content", async () => {
  observationData = data({
    organization: {
      ...data().organization,
      issueFields: {
        nodes: [{
          id: "IF_priority",
          name: "Priority",
          dataType: "SINGLE_SELECT",
          options: [{ id: "priority-high", name: "High" }],
        }],
      },
    },
    content: {
      ...data().content,
      issueFieldValues: {
        nodes: [{ field: { name: "Priority" }, optionId: "priority-high" }],
      },
    },
  });
  const input = {
    supabase: {},
    repositoryFullName: "findmydoc-platform/management",
    issueNumber: 17,
    issueNodeId: "I_issue",
    fieldName: "Priority",
    token: "token",
  };
  assert.deepEqual(await observation.loadGitHubPlanningIssueFieldObservation(input), {
    fieldName: "Priority",
    fieldValue: "High",
  });
  observationData = {
    ...observationData,
    content: { ...observationData.content, issueFieldValues: { nodes: [] } },
  };
  assert.deepEqual(await observation.loadGitHubPlanningIssueFieldObservation(input), {
    fieldName: "Priority",
    fieldValue: null,
  });
});
