import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

function supabaseWithParent(data, error = null) {
  return {
    from(table) {
      assert.equal(table, "active_tasks");
      return {
        select(columns) {
          assert.match(columns, /task_type,approval_status/);
          return this;
        },
        eq(column, value) {
          assert.equal(column, "id");
          assert.equal(value, "parent-1");
          return this;
        },
        async maybeSingle() {
          return { data, error };
        },
      };
    },
  };
}

async function loadPreflight(githubIssueLoader) {
  return loadTranspiledModule("src/lib/github-sub-issue-parent.ts", {
    "./github": {
      getGitHubIssue: githubIssueLoader,
      githubRepoSlug: (value) => value || "findmydoc-platform/management",
    },
    "./github-issue-reference": {
      resolveGitHubIssueNumber: (row) => row.github_issue_number || null,
    },
    "./planning-read-model": {
      ACTIVE_TASKS_TABLE: "active_tasks",
    },
  });
}

function validParent(overrides = {}) {
  return {
    id: "parent-1",
    task_type: "deliverable",
    approval_status: "approved",
    github_repo: "findmydoc-platform/management",
    github_issue_number: 42,
    github_issue_url: "https://github.com/findmydoc-platform/management/issues/42",
    ...overrides,
  };
}

test("preflights an active approved linked and reachable Deliverable", async () => {
  let githubReads = 0;
  const preflight = await loadPreflight(async () => {
    githubReads += 1;
    return { number: 42 };
  });

  const context = await preflight.preflightGitHubSubIssueParent(
    supabaseWithParent(validParent()),
    { parentTaskId: "parent-1" },
    "installation-token",
  );

  assert.deepEqual(context, { repository: "findmydoc-platform/management", issueNumber: 42 });
  assert.equal(githubReads, 1);
});

for (const scenario of [
  { name: "missing", data: null, error: null, message: /nicht aktiv oder nicht vorhanden/ },
  { name: "unchecked", data: null, error: { message: "database unavailable" }, message: /konnte nicht geprüft werden/ },
  { name: "not approved", data: validParent({ approval_status: "proposed" }), error: null, message: /nicht freigegeben/ },
  { name: "not a Deliverable", data: validParent({ task_type: "sub_issue" }), error: null, message: /kein Deliverable/ },
  { name: "not linked", data: validParent({ github_issue_number: null }), error: null, message: /noch nicht mit GitHub verknüpft/ },
]) {
  test(`rejects a ${scenario.name} parent without reaching GitHub`, async () => {
    let githubReads = 0;
    const preflight = await loadPreflight(async () => {
      githubReads += 1;
      return { number: 42 };
    });

    await assert.rejects(
      () => preflight.preflightGitHubSubIssueParent(
        supabaseWithParent(scenario.data, scenario.error),
        { parentTaskId: "parent-1" },
        "installation-token",
      ),
      scenario.message,
    );
    assert.equal(githubReads, 0);
  });
}

test("rejects an unreachable parent issue before the child write", async () => {
  let githubReads = 0;
  const preflight = await loadPreflight(async () => {
    githubReads += 1;
    throw new Error("GitHub Issue could not be loaded");
  });

  await assert.rejects(
    () => preflight.preflightGitHubSubIssueParent(
      supabaseWithParent(validParent()),
      { parentTaskId: "parent-1" },
      "installation-token",
    ),
    /could not be loaded/,
  );
  assert.equal(githubReads, 1);
});

test("does not write the child issue until the parent preflight completes", async () => {
  const route = await readFile("src/app/api/tasks/[id]/sync-github/route.ts", "utf8");
  const preflightIndex = route.indexOf("parentContext = await preflightGitHubSubIssueParent");
  const beginIndex = route.indexOf('supabase.rpc("begin_github_issue_sync_transaction"');
  const childWriteIndex = route.indexOf("const issue = await upsertGitHubIssue");

  assert.ok(preflightIndex > 0);
  assert.ok(preflightIndex < beginIndex);
  assert.ok(beginIndex < childWriteIndex);
  assert.doesNotMatch(route, /\.from\("tasks"\)[\s\S]*parentTaskId/);
  assert.match(route, /parentRepository: parentContext\.repository/);
  assert.match(route, /parentIssueNumber: parentContext\.issueNumber/);
});
