import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const transportFile = "src/lib/github-http.ts";
const approvedAdapters = new Set([
  "src/lib/github.ts",
  "src/lib/github-app.ts",
  "src/lib/github-project.ts",
  "src/lib/planning-github-lifecycle-github.ts",
]);
const approvedGitHubApiFiles = new Set([transportFile, ...approvedAdapters]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

test("GitHub API calls stay behind the approved transport adapters", async () => {
  const files = await sourceFiles("src");
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (source.includes("api.github.com")) {
      assert.equal(approvedGitHubApiFiles.has(file), true, `${file} must use the GitHub transport or an approved resource adapter`);
    }
    if (/from\s+["'](?:\.\/github-http|@\/lib\/github-http)["']/.test(source)) {
      assert.equal(approvedAdapters.has(file), true, `${file} must not import the GitHub transport directly`);
    }
    if (file !== transportFile) {
      assert.doesNotMatch(
        source,
        /fetch\s*\(\s*(?:"[^"\n]*api\.github\.com|'[^'\n]*api\.github\.com|`[^`]*api\.github\.com)/,
        `${file} must not fetch api.github.com directly`,
      );
    }
  }
});

test("GitHub App resource calls reuse the shared transport while OAuth remains separate", async () => {
  const source = await readFile("src/lib/github-app.ts", "utf8");
  assert.match(source, /import \{ githubJson \} from "\.\/github-http"/);
  assert.doesNotMatch(source, /async function githubJson/);
  assert.match(source, /fetch\("https:\/\/github\.com\/login\/oauth\/access_token"/);
});
