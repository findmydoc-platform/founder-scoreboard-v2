import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

test("GitHub sync keeps the route, task projection, and GraphQL seams stable", async () => {
  const route = await readFile("src/app/api/tasks/[id]/sync-github/route.ts", "utf8");
  const github = await readFile("src/lib/github.ts", "utf8");
  const projectValidation = await readFile("src/lib/github-project.ts", "utf8");

  assert.match(route, /@\/lib\/github-sync\/task-projection/);
  assert.equal((route.match(/projectTaskToGitHub/g) || []).length, 2);
  assert.doesNotMatch(route, /issue-projection|dependency-projection|project-projection/);
  assert.doesNotMatch(route, /\.rpc\(|api\.github\.com|task_relationship_edges|projectTaskGitHubIssue/);

  const graphqlUrlOwners = [];
  for (const file of await sourceFiles("src")) {
    const source = await readFile(file, "utf8");
    if (/https:\/\/api\.github\.com\/graphql/.test(source)) graphqlUrlOwners.push(file);
  }
  assert.deepEqual(graphqlUrlOwners, ["src/lib/github-graphql.ts"]);

  assert.equal(existsSync("src/lib/github-project-fields.ts"), false);
  assert.doesNotMatch(
    github,
    /export (?:async )?function (?:upsertGitHubIssue|syncGitHubIssueDependencies|taskIssueBody|taskIssueLabels|taskIssueMarker)/,
  );
  assert.doesNotMatch(
    projectValidation,
    /ensureFounderOpsGitHubProjectItem|observeFounderOpsGitHubProjectItem/,
  );
});
