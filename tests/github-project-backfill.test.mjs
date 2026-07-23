import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

async function loadBackfillModule() {
  return loadTranspiledModule("src/lib/github-project-backfill.ts", {
    "./github-issue-reference": { resolveGitHubIssueNumber: () => 1 },
    "./github-project-fields": { syncFounderOpsGitHubProjectFields: async () => ({ changes: [], warnings: [] }) },
    "./github-project": {
      ensureFounderOpsGitHubProjectItem: async () => ({ added: false, itemId: "item", projectId: "project" }),
      observeFounderOpsGitHubProjectItem: async () => ({ issueId: "issue", itemId: "item", projectId: "project" }),
      validateFounderOpsGitHubProject: async () => ({}),
    },
    "./github-project-config": {
      validGitHubProjectNumber: (value) => Number.isInteger(value) && value > 0,
      validGitHubProjectOwner: (value) => typeof value === "string" && value === "findmydoc-platform",
    },
    "./github-repositories": {
      resolveTaskGitHubRepository: () => ({ ok: true, repository: "findmydoc-platform/management" }),
    },
    "./planning-task-mappers": { mapTaskRow: (row) => row },
  });
}

test("backfill is read-only when requested and bounds apply batches", async () => {
  const backfill = await loadBackfillModule();
  const dryRun = backfill.normalizeFounderOpsGitHubProjectBackfillOptions({
    expectedOwner: "findmydoc-platform",
    expectedProjectNumber: 21,
  }, true);
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.batchSize, 10000);
  assert.equal(dryRun.includeNotSynced, false);

  const apply = backfill.normalizeFounderOpsGitHubProjectBackfillOptions({
    batchSize: 20,
    expectedOwner: "findmydoc-platform",
    expectedProjectNumber: 21,
  }, false);
  assert.equal(apply.dryRun, false);
  assert.equal(apply.batchSize, 20);

  assert.throws(
    () => backfill.normalizeFounderOpsGitHubProjectBackfillOptions({
      batchSize: 51,
      expectedOwner: "findmydoc-platform",
      expectedProjectNumber: 21,
    }, false),
    /between 1 and 50/,
  );
  assert.throws(
    () => backfill.normalizeFounderOpsGitHubProjectBackfillOptions({
      expectedOwner: "findmydoc-platform",
      expectedProjectNumber: 21,
      includeNotSynced: "yes",
    }, false),
    /must be true or false/,
  );
});

test("backfill selects deliverables before sub-issues and supports cursor resume", async () => {
  const backfill = await loadBackfillModule();
  const tasks = [
    { id: "sub-b", repository: "findmydoc-platform/website", syncStatus: "synced", taskType: "sub_issue" },
    { id: "deliverable-b", repository: "findmydoc-platform/management", syncStatus: "synced", taskType: "deliverable" },
    { id: "deliverable-a", repository: "findmydoc-platform/management", syncStatus: "synced", taskType: "deliverable" },
    { id: "sub-a", repository: "findmydoc-platform/website", syncStatus: "not_synced", taskType: "sub_issue" },
  ];
  const selected = backfill.selectFounderOpsGitHubProjectBackfillTasks(tasks, {
    afterTaskId: "",
    batchSize: 10,
    includeNotSynced: false,
    repository: "all",
  });
  assert.deepEqual(selected.map((task) => task.id), ["deliverable-a", "deliverable-b", "sub-b"]);

  const resumed = backfill.selectFounderOpsGitHubProjectBackfillTasks(tasks, {
    afterTaskId: "deliverable-a",
    batchSize: 1,
    includeNotSynced: true,
    repository: "all",
  });
  assert.deepEqual(resumed.map((task) => task.id), ["deliverable-b"]);
});

test("backfill allows only the CEO or a currently active Deputy", async () => {
  const backfill = await loadBackfillModule();
  const date = "2026-07-23";
  assert.equal(backfill.canRunFounderOpsGitHubProjectBackfill({ platform_role: "ceo" }, date), true);
  assert.equal(backfill.canRunFounderOpsGitHubProjectBackfill({
    deputy_active_from: "2026-07-01",
    deputy_active_until: "2026-07-31",
    deputy_for: "volkan",
    platform_role: "deputy",
  }, date), true);
  assert.equal(backfill.canRunFounderOpsGitHubProjectBackfill({
    deputy_active_from: "2026-07-24",
    deputy_for: "volkan",
    platform_role: "deputy",
  }, date), false);
  assert.equal(backfill.canRunFounderOpsGitHubProjectBackfill({
    deputy_active_until: "2026-07-22",
    deputy_for: "volkan",
    platform_role: "deputy",
  }, date), false);
  assert.equal(backfill.canRunFounderOpsGitHubProjectBackfill({
    deputy_for: "",
    platform_role: "deputy",
  }, date), false);
  assert.equal(backfill.canRunFounderOpsGitHubProjectBackfill({ platform_role: "founder" }, date), false);
});

test("inventory keeps linked sync state and repository counts visible", async () => {
  const backfill = await loadBackfillModule();
  assert.deepEqual(backfill.summarizeFounderOpsGitHubProjectBackfillInventory([
    { issueNumber: 1, repository: "findmydoc-platform/management", syncStatus: "synced" },
    { issueNumber: 2, repository: "findmydoc-platform/website", syncStatus: "not_synced" },
  ]), {
    byRepository: {
      "findmydoc-platform/management": 1,
      "findmydoc-platform/website": 1,
    },
    linked: 2,
    notSynced: 1,
    synced: 1,
    total: 2,
  });
});

test("delivery secret validation is fail-closed and timing-safe", async () => {
  const previous = process.env.FOUNDEROPS_DELIVERY_SECRET;
  process.env.FOUNDEROPS_DELIVERY_SECRET = "expected-secret";
  try {
    const auth = await loadTranspiledModule("src/lib/delivery-auth.ts");
    assert.equal(auth.validateDeliverySecret("expected-secret"), true);
    assert.equal(auth.validateDeliverySecret("wrong-secret"), false);
    assert.equal(auth.validateDeliverySecret(""), false);
  } finally {
    if (previous === undefined) delete process.env.FOUNDEROPS_DELIVERY_SECRET;
    else process.env.FOUNDEROPS_DELIVERY_SECRET = previous;
  }
});

test("workflow is production-protected, operational-lead mapped, and cannot remove legacy Project items", async () => {
  const workflow = await readFile(".github/workflows/backfill-founderops-github-project.yml", "utf8");
  const shell = await readFile(".github/scripts/maintenance/backfill-founderops-github-project.sh", "utf8");
  const route = await readFile("src/app/api/maintenance/github-project-backfill/route.ts", "utf8");
  const backfill = await readFile("src/lib/github-project-backfill.ts", "utf8");
  assert.match(workflow, /environment:\s*\n\s*name: production/);
  assert.match(workflow, /FOUNDEROPS_GITHUB_ACTOR: \$\{\{ github\.actor \}\}/);
  assert.match(shell, /Do not replay blindly/);
  assert.match(route, /canRunFounderOpsGitHubProjectBackfill/);
  assert.match(route, /validateDeliverySecret/);
  assert.match(backfill, /observeFounderOpsGitHubProjectItem/);
  assert.match(backfill, /ensureFounderOpsGitHubProjectItem/);
  assert.doesNotMatch(backfill, /deleteProjectV2Item|Project #20|projectNumber:\s*20/);
});
