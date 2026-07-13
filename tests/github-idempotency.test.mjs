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
