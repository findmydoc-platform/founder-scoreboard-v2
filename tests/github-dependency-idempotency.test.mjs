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
      if (table === "tasks") return resultBuilder(tasks);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

async function loadDependencyProjection({ githubJson, githubRequest = async () => new Response(null, { status: 204 }) }) {
  return loadTranspiledModule("src/lib/github-sync/dependency-projection.ts", {
    "../github": {
      listGitHubIssueBlockedBy: async (issueNumber, token, repository) => {
        const [owner, repo] = repository.split("/");
        return githubJson(
          `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocked_by?per_page=100`,
          {
            token,
            apiVersion: "2026-03-10",
            cache: "no-store",
            errorMessage: "GitHub Dependencies konnten nicht geladen werden",
          },
        );
      },
    },
    "../github-repositories": {
      normalizeGitHubRepository: (repository) => [
        "findmydoc-platform/management",
        "findmydoc-platform/website",
        "findmydoc-platform/clinic-dashboard",
      ].includes(repository) ? repository : null,
      splitGitHubRepository: (repository) => {
        const [owner, repo] = repository.split("/");
        return { owner, repo, repository };
      },
    },
    "../github-issue-reference": {
      parseGitHubIssueUrl: (value) => {
        const match = (value || "").match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
        return match ? { repository: match[1], number: Number(match[2]) } : null;
      },
      resolveGitHubIssueNumber: (row) => row.github_issue_number || null,
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
      if (url.includes("/dependencies/blocking?")) return [];
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
    githubJson: async (url) => {
      if (url.includes("/dependencies/blocked_by?")) {
        return [{ id: 200, number: 20, html_url: "managed" }];
      }
      if (url.includes("/dependencies/blocking?")) return [];
      throw new Error(`Unexpected GitHub request: ${url}`);
    },
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
    githubJson: async (url) => (
      url.includes("/dependencies/blocked_by?")
        ? [{ id: 200, number: 20, html_url: "managed" }]
        : []
    ),
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
    githubJson: async (url) => (
      url.includes("/dependencies/blocked_by?")
        ? [
            { id: 200, number: 20, html_url: "managed" },
            { id: 990, number: 99, html_url: "unmanaged" },
          ]
        : []
    ),
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

test("syncing the blocking task removes a stale outgoing dependency", async () => {
  const removed = [];
  const projection = await loadDependencyProjection({
    githubJson: async (url, options) => {
      if (url.includes("/dependencies/blocked_by?")) return [];
      if (url.includes("/dependencies/blocking?")) {
        return [{ id: 200, number: 20, html_url: "managed" }];
      }
      if (url.endsWith("/issues/10") && (!options.method || options.method === "GET")) {
        return { id: 100, number: 10, html_url: "current" };
      }
      throw new Error(`Unexpected GitHub request: ${options.method || "GET"} ${url}`);
    },
    githubRequest: async (url) => {
      removed.push(url);
      return new Response(null, { status: 204 });
    },
  });

  const result = await projection.projectTaskGitHubDependencies(projectionInput(
    supabaseFixture({
      tasks: [
        linkedTasks()[0],
        { ...linkedTasks()[1], trashed_at: "2026-07-27T00:00:00.000Z" },
      ],
    }),
  ));

  assert.deepEqual(result, { added: 0, removed: 1 });
  assert.deepEqual(removed, [
    "https://api.github.com/repos/findmydoc-platform/management/issues/20/dependencies/blocked_by/100",
  ]);
});

test("syncing the blocking task creates a missing outgoing dependency", async () => {
  const posts = [];
  const projection = await loadDependencyProjection({
    githubJson: async (url, options) => {
      if (url.includes("/dependencies/blocked_by?")) return [];
      if (url.includes("/dependencies/blocking?")) return [];
      if (url.endsWith("/issues/10") && (!options.method || options.method === "GET")) {
        return { id: 100, number: 10, html_url: "current" };
      }
      if (options.method === "POST") {
        posts.push({ url, body: options.body });
        return { id: 100, number: 10, html_url: "current" };
      }
      throw new Error(`Unexpected GitHub request: ${options.method || "GET"} ${url}`);
    },
  });
  const supabase = supabaseFixture({
    relationships: [{
      id: 2,
      task_id: "task-10",
      related_task_id: "task-20",
      relation_type: "blocks",
    }],
    tasks: linkedTasks(),
  });

  const result = await projection.projectTaskGitHubDependencies(projectionInput(supabase));

  assert.deepEqual(result, { added: 1, removed: 0 });
  assert.deepEqual(posts, [{
    url: "https://api.github.com/repos/findmydoc-platform/management/issues/20/dependencies/blocked_by",
    body: { issue_id: 100 },
  }]);
});

test("a lost outgoing dependency-add response is reconciled before another POST", async () => {
  let relationshipExists = false;
  let addCalls = 0;
  const projection = await loadDependencyProjection({
    githubJson: async (url, options) => {
      if (url.includes("/dependencies/blocked_by?")) return [];
      if (url.includes("/dependencies/blocking?")) {
        return relationshipExists
          ? [{ id: 200, number: 20, html_url: "managed" }]
          : [];
      }
      if (url.endsWith("/issues/10") && (!options.method || options.method === "GET")) {
        return { id: 100, number: 10, html_url: "current" };
      }
      if (options.method === "POST") {
        addCalls += 1;
        relationshipExists = true;
        throw new Error("response lost after outgoing dependency creation");
      }
      throw new Error(`Unexpected GitHub request: ${options.method || "GET"} ${url}`);
    },
  });
  const supabase = supabaseFixture({
    relationships: [{
      id: 2,
      task_id: "task-10",
      related_task_id: "task-20",
      relation_type: "blocks",
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

test("cross-repository dependencies keep repository identity even when Issue numbers match", async () => {
  const posts = [];
  const projection = await loadDependencyProjection({
    githubJson: async (url, options) => {
      if (url.includes("/dependencies/blocked_by?") || url.includes("/dependencies/blocking?")) return [];
      if (url === "https://api.github.com/repos/findmydoc-platform/website/issues/10") {
        return { id: 210, number: 10, html_url: "website-10" };
      }
      if (options.method === "POST") {
        posts.push({ url, body: options.body });
        return { id: 210, number: 10, html_url: "website-10" };
      }
      throw new Error(`Unexpected GitHub request: ${options.method || "GET"} ${url}`);
    },
  });
  const result = await projection.projectTaskGitHubDependencies(projectionInput(
    supabaseFixture({
      relationships: [{
        id: 3,
        task_id: "task-10",
        related_task_id: "website-10",
        relation_type: "blocked_by",
      }],
      tasks: [
        linkedTasks()[0],
        { id: "website-10", github_repo: "findmydoc-platform/website", github_issue_number: 10 },
      ],
    }),
  ));

  assert.deepEqual(result, { added: 1, removed: 0 });
  assert.deepEqual(posts, [{
    url: "https://api.github.com/repos/findmydoc-platform/management/issues/10/dependencies/blocked_by",
    body: { issue_id: 210 },
  }]);
});

test("stale cross-repository dependencies are removed from the correct blocked Issue", async () => {
  const removed = [];
  const projection = await loadDependencyProjection({
    githubJson: async (url, options) => {
      if (url.includes("/dependencies/blocked_by?")) return [];
      if (url.includes("/dependencies/blocking?")) {
        return [{
          id: 220,
          number: 20,
          html_url: "website-20",
          repository_url: "https://api.github.com/repos/findmydoc-platform/website",
        }];
      }
      if (url === "https://api.github.com/repos/findmydoc-platform/management/issues/10" && !options.method) {
        return { id: 100, number: 10, html_url: "management-10" };
      }
      throw new Error(`Unexpected GitHub request: ${options.method || "GET"} ${url}`);
    },
    githubRequest: async (url) => {
      removed.push(url);
      return new Response(null, { status: 204 });
    },
  });
  const result = await projection.projectTaskGitHubDependencies(projectionInput(
    supabaseFixture({
      tasks: [
        linkedTasks()[0],
        { id: "website-20", github_repo: "findmydoc-platform/website", github_issue_number: 20 },
      ],
    }),
  ));

  assert.deepEqual(result, { added: 0, removed: 1 });
  assert.deepEqual(removed, [
    "https://api.github.com/repos/findmydoc-platform/website/issues/20/dependencies/blocked_by/100",
  ]);
});
