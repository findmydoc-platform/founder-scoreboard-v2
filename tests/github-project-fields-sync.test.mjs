import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

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
  sprintIterations = [{ id: "sprint-6", title: "Sprint 6", startDate: "2026-07-17" }],
  workstreamOptions = [{ id: "workstream-founderops", name: "FounderOps" }],
} = {}) {
  return {
    data: {
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
                configuration: { iterations: sprintIterations, completedIterations: [] },
              },
              { id: "field-workstream", name: "Workstream", dataType: "SINGLE_SELECT", options: workstreamOptions },
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
            { id: "issue-field-effort", name: "Effort", dataType: "SINGLE_SELECT", options: [{ id: "effort-high", name: "High" }] },
          ],
        },
      },
      node: {
        id: "item-1",
        project: { id: "project-21" },
        content: { id: "issue-1", issueFieldValues: { nodes: issueValues } },
        fieldValues: { nodes: projectValues },
      },
    },
  };
}

const task = {
  deadline: "2026-08-01",
  evidenceLink: "",
  hours: 0,
  priority: "P4",
  startDate: "",
  status: "Review",
  workstream: " founderops ",
};

async function loadFieldModule(handler) {
  return loadTranspiledModule("src/lib/github-project-fields.ts", {
    "./github-http": { githubJson: handler },
  });
}

test("status and priority mappings cover every supported FounderOps value", async () => {
  const fields = await loadFieldModule(async () => fieldContext());
  assert.deepEqual(
    ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"].map(fields.githubProjectStatusOption),
    ["Todo", "In Progress", "Review", "Changes Requested", "Blocked", "Done"],
  );
  assert.deepEqual(
    ["P0", "P1", "P2", "P3", "P4"].map(fields.githubIssuePriorityOption),
    ["Urgent", "High", "Medium", "Low", "Low"],
  );
});

test("field sync writes exact values, clears blanks, preserves Effort, and includes zero hours", async () => {
  const mutations = [];
  const fields = await loadFieldModule(async (_url, options) => {
    if (options.body.query.includes("FounderOpsProjectFields")) return fieldContext();
    mutations.push(options.body);
    return { data: { ok: true } };
  });

  const result = await fields.syncFounderOpsGitHubProjectFields({
    itemId: "item-1",
    projectId: "project-21",
    projectNumber: 21,
    projectOwner: "findmydoc-platform",
    sprint: { title: "Sprint 6", startDate: "2026-07-17" },
    task,
    token: "token",
  });

  assert.deepEqual(result.warnings, []);
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

test("matching values make repeated field sync mutation-free", async () => {
  let mutations = 0;
  const fields = await loadFieldModule(async (_url, options) => {
    if (options.body.query.includes("FounderOpsProjectFields")) {
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
    return { data: { ok: true } };
  });

  const result = await fields.syncFounderOpsGitHubProjectFields({
    itemId: "item-1",
    projectId: "project-21",
    projectNumber: 21,
    projectOwner: "findmydoc-platform",
    sprint: { title: "Sprint 6", startDate: "2026-07-17" },
    task,
    token: "token",
  });

  assert.deepEqual(result.warnings, []);
  assert.equal(mutations, 0);
});

test("field dry run reports exact changes without mutations", async () => {
  let mutations = 0;
  const fields = await loadFieldModule(async (_url, options) => {
    if (options.body.query.includes("FounderOpsProjectFields")) return fieldContext();
    mutations += 1;
    throw new Error("mutation must not run");
  });

  const result = await fields.syncFounderOpsGitHubProjectFields({
    dryRun: true,
    itemId: "item-1",
    projectId: "project-21",
    projectNumber: 21,
    projectOwner: "findmydoc-platform",
    sprint: { title: "Sprint 6", startDate: "2026-07-17" },
    task,
    token: "token",
  });

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.changes, [
    "Status",
    "Sprint",
    "Workstream",
    "Estimate hours",
    "Evidence URL",
    "Priority",
    "Start date",
    "Target date",
  ]);
  assert.equal(mutations, 0);
});

test("empty planning values clear Sprint, Workstream, evidence, and both dates", async () => {
  const mutations = [];
  const fields = await loadFieldModule(async (_url, options) => {
    if (options.body.query.includes("FounderOpsProjectFields")) {
      return fieldContext({
        issueValues: [
          { field: { name: "Priority" }, optionId: "priority-low" },
          { field: { name: "Start date" }, value: "2026-07-01" },
          { field: { name: "Target date" }, value: "2026-08-01" },
        ],
      });
    }
    mutations.push(options.body);
    return { data: { ok: true } };
  });

  const result = await fields.syncFounderOpsGitHubProjectFields({
    itemId: "item-1",
    projectId: "project-21",
    projectNumber: 21,
    projectOwner: "findmydoc-platform",
    sprint: null,
    task: { ...task, deadline: "", workstream: "" },
    token: "token",
  });

  assert.deepEqual(result.warnings, []);
  const projectClears = mutations
    .filter((mutation) => mutation.query.includes("ClearFounderOpsProjectField"))
    .map((mutation) => mutation.variables.fieldId);
  assert.deepEqual(projectClears.sort(), ["field-evidence", "field-sprint", "field-workstream"].sort());
  const issueDeletes = mutations
    .filter((mutation) => mutation.query.includes("SetFounderOpsIssueField"))
    .map((mutation) => mutation.variables.issueFields[0])
    .filter((value) => value.delete);
  assert.deepEqual(issueDeletes, [
    { fieldId: "issue-field-start", delete: true },
    { fieldId: "issue-field-target", delete: true },
  ]);
});

test("missing Sprint and Workstream options clear old values and return warnings", async () => {
  const mutations = [];
  const fields = await loadFieldModule(async (_url, options) => {
    if (options.body.query.includes("FounderOpsProjectFields")) {
      return fieldContext({ sprintIterations: [], workstreamOptions: [] });
    }
    mutations.push(options.body);
    return { data: { ok: true } };
  });

  const result = await fields.syncFounderOpsGitHubProjectFields({
    itemId: "item-1",
    projectId: "project-21",
    projectNumber: 21,
    projectOwner: "findmydoc-platform",
    sprint: { title: "Sprint 99", startDate: "2026-12-01" },
    task: { ...task, workstream: "Unknown Workstream" },
    token: "token",
  });

  const cleared = mutations
    .filter((mutation) => mutation.query.includes("ClearFounderOpsProjectField"))
    .map((mutation) => mutation.variables.fieldId);
  assert.equal(cleared.includes("field-sprint"), true);
  assert.equal(cleared.includes("field-workstream"), true);
  assert.equal(result.warnings.some((warning) => warning.includes("Sprint 99") && warning.includes("alter Wert wurde entfernt")), true);
  assert.equal(result.warnings.some((warning) => warning.includes("Unknown Workstream") && warning.includes("alter Wert wurde entfernt")), true);
});

test("one optional field failure becomes a warning while later fields continue", async () => {
  const mutations = [];
  const fields = await loadFieldModule(async (_url, options) => {
    if (options.body.query.includes("FounderOpsProjectFields")) return fieldContext();
    if (options.body.variables.fieldId === "field-hours") throw new Error("number update rejected");
    mutations.push(options.body);
    return { data: { ok: true } };
  });

  const result = await fields.syncFounderOpsGitHubProjectFields({
    itemId: "item-1",
    projectId: "project-21",
    projectNumber: 21,
    projectOwner: "findmydoc-platform",
    sprint: { title: "Sprint 6", startDate: "2026-07-17" },
    task,
    token: "token",
  });

  assert.equal(result.warnings.some((warning) => warning.includes("Estimate hours") && warning.includes("number update rejected")), true);
  assert.equal(mutations.some((mutation) => mutation.variables.fieldId === "field-evidence"), true);
  assert.equal(mutations.some((mutation) => mutation.query.includes("SetFounderOpsIssueField")), true);
});

test("task sync keeps Project membership hard and field failures warning-only", async () => {
  const source = await readFile("src/app/api/tasks/[id]/sync-github/route.ts", "utf8");
  const membership = source.indexOf("await ensureFounderOpsGitHubProjectItem");
  const fields = source.indexOf("await syncFounderOpsGitHubProjectFields");
  const failurePersistence = source.indexOf("persistGitHubSyncFailure", fields);
  assert.ok(membership > 0 && fields > membership);
  assert.match(source.slice(fields, failurePersistence), /\.catch\(\(error\) => \(\{/);
  assert.match(source, /\.\.\.fieldSync\.warnings/);
});
