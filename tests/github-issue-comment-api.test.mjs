import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

test("the Issue comment loader uses the approved repository-scoped GitHub transport", async () => {
  let request = null;
  const github = await loadTranspiledModule("src/lib/github.ts", {
    "./github-repositories": {
      requireAllowedGitHubRepository: (value) => value || "findmydoc-platform/management",
      splitGitHubRepository: (value) => {
        const repository = value || "findmydoc-platform/management";
        const [owner, repo] = repository.split("/");
        return { owner, repo, repository };
      },
    },
    "./github-graphql": {
      githubGraphql: async () => {
        throw new Error("Unexpected GitHub GraphQL request");
      },
    },
    "./github-http": {
      GitHubApiError: class extends Error {},
      githubJson: async (url, options) => {
        request = { url, options };
        return {
          id: 5307392288,
          body: "Webhook comment",
          html_url: "https://github.com/findmydoc-platform/website/issues/1619#issuecomment-5307392288",
          issue_url: "https://api.github.com/repos/findmydoc-platform/website/issues/1619",
          created_at: "2026-08-16T12:17:41Z",
          updated_at: "2026-08-16T12:18:03Z",
          user: { login: "SebastianSchuetze" },
        };
      },
    },
  });

  const comment = await github.getGitHubIssueComment(
    5307392288,
    "installation-token",
    "findmydoc-platform/website",
  );

  assert.equal(comment.id, 5307392288);
  assert.equal(comment.updated_at, "2026-08-16T12:18:03Z");
  assert.equal(
    request.url,
    "https://api.github.com/repos/findmydoc-platform/website/issues/comments/5307392288",
  );
  assert.equal(request.options.token, "installation-token");
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.method, undefined);
  assert.equal(
    github.isGitHubIssueApiUrl(
      "https://api.github.com/repos/findmydoc-platform/website/issues/1619",
      1619,
      "findmydoc-platform/website",
    ),
    true,
  );
  assert.equal(
    github.isGitHubIssueApiUrl(
      "https://api.github.com.evil.example/repos/findmydoc-platform/website/issues/1619",
      1619,
      "findmydoc-platform/website",
    ),
    false,
  );
});
