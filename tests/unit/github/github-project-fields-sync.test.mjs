import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const projectFieldContext = await importTestModule("src/lib/github-sync/project-field-context.ts");

const statusOptions = [
  ["status-todo", "Todo"],
  ["status-progress", "In Progress"],
  ["status-review", "Review"],
  ["status-changes", "Changes Requested"],
  ["status-blocked", "Blocked"],
  ["status-done", "Done"],
].map(([id, name]) => ({ id, name }));

function fieldContext({
  projectValues = [
    { field: { id: "field-status", name: "Status" }, optionId: "status-todo" },
    { field: { id: "field-sprint", name: "Sprint" }, iterationId: "sprint-old" },
    { field: { id: "field-workstream", name: "Workstream" }, optionId: "workstream-old" },
    { field: { id: "field-hours", name: "Estimate hours" }, number: 4 },
    { field: { id: "field-evidence", name: "Evidence URL" }, text: "https://old.example" },
  ],
  issueValues = [
    { field: { name: "Priority" }, optionId: "priority-urgent" },
    { field: { name: "Start date" }, value: "2026-07-01" },
  ],
} = {}) {
  return {
    organization: {
      projectV2: {
        id: "project-21",
        closed: false,
        fields: {
          nodes: [
            { id: "field-status", name: "Status", dataType: "SINGLE_SELECT", options: statusOptions },
            {
              id: "field-sprint",
              name: "Sprint",
              dataType: "ITERATION",
              configuration: {
                iterations: [{ id: "sprint-6", title: "Sprint 6", startDate: "2026-07-17" }],
                completedIterations: [],
              },
            },
            {
              id: "field-workstream",
              name: "Workstream",
              dataType: "SINGLE_SELECT",
              options: [{ id: "workstream-founderops", name: "FounderOps" }],
            },
            { id: "field-hours", name: "Estimate hours", dataType: "NUMBER" },
            { id: "field-evidence", name: "Evidence URL", dataType: "TEXT" },
          ],
        },
      },
      issueFields: {
        nodes: [
          {
            id: "issue-field-priority",
            name: "Priority",
            dataType: "SINGLE_SELECT",
            options: [
              { id: "priority-urgent", name: "Urgent" },
              { id: "priority-high", name: "High" },
              { id: "priority-medium", name: "Medium" },
              { id: "priority-low", name: "Low" },
            ],
          },
          { id: "issue-field-start", name: "Start date", dataType: "DATE" },
          { id: "issue-field-target", name: "Target date", dataType: "DATE" },
          {
            id: "issue-field-effort",
            name: "Effort",
            dataType: "SINGLE_SELECT",
            options: [{ id: "effort-high", name: "High" }],
          },
        ],
      },
    },
    node: {
      id: "item-1",
      project: { id: "project-21" },
      content: { id: "issue-1", issueFieldValues: { nodes: issueValues } },
      fieldValues: { nodes: projectValues },
    },
  };
}

function supabaseFixture() {
  return {
    from(table) {
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
        maybeSingle: async () => ({
          data: { name: "Sprint 6", start_date: "2026-07-17" },
          error: null,
        }),
      };
      if (table !== "projects" && table !== "sprints") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return builder;
    },
  };
}

const task = {
  fixedDate: "2026-08-01",
  evidenceLink: "",
  hours: 0,
  priority: "P4",
  status: "Review",
  taskType: "deliverable",
  workstream: " founderops ",
  sprintId: "sprint-6",
};

async function loadProjectProjection(handler) {
  return importTestModule("src/lib/github-sync/project-projection.ts", {
    "../github-graphql": { githubGraphql: handler },
    "../github-project-config": {
      validGitHubProjectOwner: (value) => typeof value === "string" && Boolean(value),
      validGitHubProjectNumber: (value) => Number.isInteger(value) && value > 0,
    },
    "../github-repositories": {
      splitGitHubRepository: (repository) => {
        const [owner, repo] = repository.split("/");
        return { owner, repo, repository };
      },
    },
    "./project-field-context": projectFieldContext,
  });
}

function membershipData() {
  return {
    organization: { projectV2: { id: "project-21", closed: false } },
    repository: {
      issue: {
        id: "issue-1",
        projectItems: { nodes: [{ id: "item-1", project: { id: "project-21" } }] },
      },
    },
  };
}

function projectionInput(overrides = {}) {
  return {
    supabase: supabaseFixture(),
    issueNumber: 42,
    repository: "findmydoc-platform/management",
    token: "token",
    task: { ...task, ...overrides },
  };
}

test("Project projection writes exact values, clears blanks, preserves Effort, and serializes mutations", async () => {
  const mutations = [];
  let inFlight = 0;
  let maximumInFlight = 0;
  const project = await loadProjectProjection(async ({ query, variables }) => {
    if (query.includes("FounderOpsProjectMembership")) return membershipData();
    if (query.includes("FounderOpsProjectFields")) return fieldContext();
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    await Promise.resolve();
    mutations.push({ query, variables });
    inFlight -= 1;
    return { ok: true };
  });

  const result = await project.projectTaskToFounderOpsGitHubProject(projectionInput());
  assert.deepEqual(result.warnings, []);
  assert.equal(maximumInFlight, 1);

  const byFieldId = new Map(mutations.map((mutation) => [mutation.variables.fieldId, mutation]));
  assert.deepEqual(byFieldId.get("field-status").variables.value, { singleSelectOptionId: "status-review" });
  assert.deepEqual(byFieldId.get("field-sprint").variables.value, { iterationId: "sprint-6" });
  assert.deepEqual(byFieldId.get("field-workstream").variables.value, { singleSelectOptionId: "workstream-founderops" });
  assert.deepEqual(byFieldId.get("field-hours").variables.value, { number: 0 });
  assert.equal(byFieldId.get("field-evidence").query.includes("ClearFounderOpsProjectField"), true);

  const issueMutations = mutations.filter((mutation) => mutation.query.includes("SetFounderOpsIssueField"));
  assert.deepEqual(issueMutations.map((mutation) => mutation.variables.issueFields[0]), [
    { fieldId: "issue-field-priority", singleSelectOptionId: "priority-low" },
    { fieldId: "issue-field-start", delete: true },
    { fieldId: "issue-field-target", dateValue: "2026-08-01" },
  ]);
  assert.equal(JSON.stringify(mutations).includes("issue-field-effort"), false);
});

test("Sub-Issue Project projection changes only working status", async () => {
  const mutations = [];
  const project = await loadProjectProjection(async ({ query, variables }) => {
    if (query.includes("FounderOpsProjectMembership")) return membershipData();
    if (query.includes("FounderOpsProjectFields")) return fieldContext();
    mutations.push({ query, variables });
    return { ok: true };
  });

  const result = await project.projectTaskToFounderOpsGitHubProject(projectionInput({
    status: "Blockiert",
    taskType: "sub_issue",
    sprintId: "",
  }));
  assert.deepEqual(result.warnings, []);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].variables.fieldId, "field-status");
  assert.deepEqual(mutations[0].variables.value, { singleSelectOptionId: "status-blocked" });
});

test("matching Project values make replay mutation-free", async () => {
  let mutations = 0;
  const project = await loadProjectProjection(async ({ query }) => {
    if (query.includes("FounderOpsProjectMembership")) return membershipData();
    if (query.includes("FounderOpsProjectFields")) {
      return fieldContext({
        projectValues: [
          { field: { id: "field-status", name: "Status" }, optionId: "status-review" },
          { field: { id: "field-sprint", name: "Sprint" }, iterationId: "sprint-6" },
          { field: { id: "field-workstream", name: "Workstream" }, optionId: "workstream-founderops" },
          { field: { id: "field-hours", name: "Estimate hours" }, number: 0 },
        ],
        issueValues: [
          { field: { name: "Priority" }, optionId: "priority-low" },
          { field: { name: "Target date" }, value: "2026-08-01" },
        ],
      });
    }
    mutations += 1;
    return { ok: true };
  });
  const result = await project.projectTaskToFounderOpsGitHubProject(projectionInput());
  assert.deepEqual(result, { changes: [], warnings: [] });
  assert.equal(mutations, 0);
});

test("one Project field failure becomes a warning while later fields continue", async () => {
  const mutations = [];
  const project = await loadProjectProjection(async ({ query, variables }) => {
    if (query.includes("FounderOpsProjectMembership")) return membershipData();
    if (query.includes("FounderOpsProjectFields")) return fieldContext();
    if (variables.fieldId === "field-hours") throw new Error("number update rejected");
    mutations.push({ query, variables });
    return { ok: true };
  });
  const result = await project.projectTaskToFounderOpsGitHubProject(projectionInput());
  assert.equal(
    result.warnings.some((warning) => warning.includes("Estimate hours") && warning.includes("number update rejected")),
    true,
  );
  assert.equal(mutations.some((mutation) => mutation.variables.fieldId === "field-evidence"), true);
  assert.equal(mutations.some((mutation) => mutation.query.includes("SetFounderOpsIssueField")), true);
});
