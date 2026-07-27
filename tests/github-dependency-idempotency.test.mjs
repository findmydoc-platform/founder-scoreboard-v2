import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

class MockGitHubApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function resultBuilder(data) {
  const filters = [];
  const builder = {
    select: () => builder,
    eq: (field, value) => {
      filters.push([field, value]);
      return builder;
    },
    in: async () => ({
      data: data.filter((row) => filters.every(([field, value]) => row[field] === value)),
      error: null,
    }),
    then: (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject),
  };
  return builder;
}

function supabaseFixture({ relationships = [], tasks = [] } = {}) {
  return {
    from(table) {
      if (table === "task_relationship_edges") return resultBuilder(relationships);
      if (table === "active_tasks") return resultBuilder(tasks);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

async function loadDependencyProjection({ githubJson, githubRequest = async () => new Response(null, { status: 204 }) }) {
  return loadTranspiledModule("src/lib/github-sync/dependency-projection.ts", {
    "../github-repositories": {
      splitGitHubRepository: (repository) => {
        const [owner, repo] = repository.split("/");
        return { owner, repo, repository };
      },
    },
    "../github-issue-reference": {
      resolveGitHubIssueNumber: (row) => row.github_issue_number || null,
    },
    "../planning-read-model": {
      ACTIVE_TASKS_TABLE: "active_tasks",
    },
    "../github-http": {
      GITHUB_ISSUE_DEPENDENCY_API_VERSION: "2026-03-10",
      githubJson,
      githubRequest,
    },
  });
}

function projectionInput(supabase) {
  return {
    supabase,
    taskId: "task-10",
    currentIssueNumber: 10,
    repository: "findmydoc-platform/management",
    token: "installation-token",
  };
}

function linkedTasks() {
  return [
    { id: "task-10", github_repo: "findmydoc-platform/management", github_issue_number: 10 },
    { id: "task-20", github_repo: "findmydoc-platform/management", github_issue_number: 20 },
  ];
}

test("a lost dependency-add response is reconciled before another POST", async () => {
  let relationshipExists = false;
  let addCalls = 0;
  const projection = await loadDependencyProjection({
    githubJson: async (url, options) => {
      if (url.includes("/dependencies/blocked_by?")) {
        return relationshipExists ? [{
          id: 200,
          number: 20,
          html_url: "https://github.com/findmydoc-platform/management/issues/20",
        }] : [];
      }
      if (url.endsWith("/issues/20") && (!options.method || options.method === "GET")) {
        return {
          id: 200,
          number: 20,
          html_url: "https://github.com/findmydoc-platform/management/issues/20",
        };
      }
      if (options.method === "POST") {
        addCalls += 1;
        relationshipExists = true;
        throw new Error("response lost after dependency creation");
      }
      throw new Error(`Unexpected GitHub request: ${options.method || "GET"} ${url}`);
    },
  });
  const supabase = supabaseFixture({
    relationships: [{
      id: 1,
      task_id: "task-10",
      related_task_id: "task-20",
      relation_type: "blocked_by",
    }],
    tasks: linkedTasks(),
  });

  await assert.rejects(
    () => projection.projectTaskGitHubDependencies(projectionInput(supabase)),
    /response lost/,
  );
  await projection.projectTaskGitHubDependencies(projectionInput(supabase));
  assert.equal(addCalls, 1);
});

test("dependency removal accepts only the observed relationship's 404", async () => {
  let request;
  const projection = await loadDependencyProjection({
    githubJson: async (url) => (
      url.includes("/dependencies/blocked_by?")
        ? [{ id: 200, number: 20, html_url: "managed" }]
        : []
    ),
    githubRequest: async (url, options) => {
      request = { url, options };
      return new Response(null, { status: 404 });
    },
  });
  await projection.projectTaskGitHubDependencies(projectionInput(
    supabaseFixture({ tasks: linkedTasks() }),
  ));

  assert.match(request.url, /\/issues\/10\/dependencies\/blocked_by\/200$/);
  assert.equal(request.options.method, "DELETE");
  assert.equal(request.options.operation, "mutation");
  assert.deepEqual(request.options.allowedStatuses, [404]);
});

test("dependency removal does not suppress permission failures", async () => {
  const projection = await loadDependencyProjection({
    githubJson: async () => [{ id: 200, number: 20, html_url: "managed" }],
    githubRequest: async () => {
      throw new MockGitHubApiError("forbidden", 403);
    },
  });

  await assert.rejects(
    () => projection.projectTaskGitHubDependencies(projectionInput(
      supabaseFixture({ tasks: linkedTasks() }),
    )),
    (error) => error.status === 403,
  );
});

test("dependency sync removes only stale relationships from the managed set", async () => {
  const removed = [];
  const projection = await loadDependencyProjection({
    githubJson: async () => [
      { id: 200, number: 20, html_url: "managed" },
      { id: 990, number: 99, html_url: "unmanaged" },
    ],
    githubRequest: async (url) => {
      removed.push(url);
      return new Response(null, { status: 204 });
    },
  });

  const result = await projection.projectTaskGitHubDependencies(projectionInput(
    supabaseFixture({ tasks: linkedTasks() }),
  ));
  assert.deepEqual(result, { added: 0, removed: 1 });
  assert.equal(removed.length, 1);
  assert.match(removed[0], /\/blocked_by\/200$/);
});
