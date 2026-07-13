import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

function task() {
  return {
    id: "task-idempotency-verification",
    title: "Idempotent GitHub issue creation",
    taskType: "deliverable",
    status: "Offen",
    priority: "P2",
    issueNumber: "",
    issueUrl: "",
    githubIssueNumber: null,
    githubIssueUrl: "",
  };
}

test("github issue creation reuses an issue with the durable FounderOps marker", async () => {
  const { taskIssueBody, taskIssueMarker, upsertGitHubIssue } = await loadTranspiledModule("src/lib/github.ts", {
    "./github-repositories": {
      requireAllowedGitHubRepository: (value) => value || "findmydoc-platform/management",
      splitGitHubRepository: (value) => {
        const repository = value || "findmydoc-platform/management";
        const [owner, repo] = repository.split("/");
        return { owner, repo, repository };
      },
    },
    "./github-issue-reference": {
      assertGitHubIssueRepository: () => {},
      parseGitHubIssueUrl: (value) => {
        const match = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
        return match ? { repository: match[1], number: Number(match[2]) } : null;
      },
      resolveGitHubIssueNumber: (value) => value.githubIssueNumber || Number(value.issueNumber || 0) || null,
    },
    "./github-http": {
      githubRequest: (url, options) => globalThis.fetch(url, {
        method: options.method || "GET",
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
      githubJson: async (url, options) => {
        const response = await globalThis.fetch(url, {
          method: options.method || "GET",
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        return response.json();
      },
    },
  });
  const sourceTask = task();
  const marker = taskIssueMarker(sourceTask.id);
  const requests = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || "GET", body: options.body || "" });
    if (String(url).includes("/search/issues")) {
      return new Response(JSON.stringify({
        items: [{
          number: 42,
          html_url: "https://github.com/findmydoc-platform/management/issues/42",
          body: `Existing issue\n${marker}`,
        }],
      }), { status: 200 });
    }
    if (String(url).endsWith("/issues/42") && (!options.method || options.method === "GET")) {
      return new Response(JSON.stringify({
        number: 42,
        labels: [{ name: "customer-reported" }, { name: "P1-High" }],
        html_url: "https://github.com/findmydoc-platform/management/issues/42",
        title: "Existing marker-owned issue",
        body: marker,
      }), { status: 200 });
    }
    if (String(url).endsWith("/issues/42") && options.method === "PATCH") {
      return new Response(JSON.stringify({
        number: 42,
        html_url: "https://github.com/findmydoc-platform/management/issues/42",
      }), { status: 200 });
    }
    throw new Error(`Unexpected GitHub request: ${options.method || "GET"} ${url}`);
  };

  try {
    const issue = await upsertGitHubIssue(sourceTask, "installation-token");

    assert.equal(issue.number, 42);
    assert.equal(issue.recovered, true);
    assert.equal(issue.recreated, false);
    assert.match(taskIssueBody(sourceTask), /<!-- founderops-task-id:task-idempotency-verification -->/);
    assert.equal(requests.some((request) => request.method === "POST"), false);
    assert.equal(requests.filter((request) => request.method === "GET" && request.url.endsWith("/issues/42")).length, 1);
    assert.equal(requests.filter((request) => request.method === "PATCH").length, 1);
    const update = requests.find((request) => request.method === "PATCH");
    assert.deepEqual(JSON.parse(update.body).labels, ["customer-reported", "task", "deliverable", "P2-Medium"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("github issue creation reconciles a lost success response before another POST", async () => {
  const sourceTask = task();
  const marker = `<!-- founderops-task-id:${sourceTask.id} -->`;
  let created = false;
  let createCalls = 0;
  const requests = [];
  const github = await loadTranspiledModule("src/lib/github.ts", {
    "./github-repositories": {
      requireAllowedGitHubRepository: (value) => value || "findmydoc-platform/management",
      splitGitHubRepository: (value) => {
        const repository = value || "findmydoc-platform/management";
        const [owner, repo] = repository.split("/");
        return { owner, repo, repository };
      },
    },
    "./github-issue-reference": {
      assertGitHubIssueRepository: () => {},
      parseGitHubIssueUrl: (value) => {
        const match = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
        return match ? { repository: match[1], number: Number(match[2]) } : null;
      },
      resolveGitHubIssueNumber: () => null,
    },
    "./github-http": {
      githubRequest: async (url) => {
        requests.push({ method: "GET", url });
        if (url.includes("/search/issues")) {
          return new Response(JSON.stringify({
            incomplete_results: false,
            items: created ? [{
              number: 42,
              html_url: "https://github.com/findmydoc-platform/management/issues/42",
              body: marker,
            }] : [],
          }), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      },
      githubJson: async (url, options) => {
        requests.push({ method: options.method || "GET", url });
        if (options.method === "POST") {
          createCalls += 1;
          created = true;
          throw new Error("response lost after GitHub created the issue");
        }
        if ((!options.method || options.method === "GET") && url.endsWith("/issues/42")) {
          return {
            number: 42,
            html_url: "https://github.com/findmydoc-platform/management/issues/42",
            title: "Existing marker-owned issue",
            body: marker,
            labels: [],
          };
        }
        if (options.method === "PATCH") {
          return { number: 42, html_url: "https://github.com/findmydoc-platform/management/issues/42" };
        }
        throw new Error(`Unexpected GitHub request: ${options.method || "GET"} ${url}`);
      },
    },
  });

  await assert.rejects(
    () => github.upsertGitHubIssue(sourceTask, "installation-token"),
    /response lost/,
  );
  const replayed = await github.upsertGitHubIssue(sourceTask, "installation-token");

  assert.equal(replayed.number, 42);
  assert.equal(replayed.recovered, true);
  assert.equal(createCalls, 1);
  assert.equal(requests.filter((request) => request.method === "POST").length, 1);
});
