import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const removedRuntimePaths = [
  "src/app/api/planning-data/route.ts",
  "src/lib/planning-data.ts",
  "src/lib/planning-data-loader.ts",
  "src/lib/planning-data-scopes.ts",
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

test("the removed global planning read layer cannot re-enter active source", async () => {
  for (const path of removedRuntimePaths) assert.equal(existsSync(path), false, `${path} must stay removed`);

  const files = await sourceFiles("src");
  const forbidden = /(?:\bPlanningData\b|\/api\/planning-data(?:[?/'"`]|$)|planning-data-(?:loader|scopes)|WorkspaceCompositionStateQueryScope)/;
  for (const path of files) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, forbidden, `${path} must use a consumer-owned read model`);
  }
});

test("the client composition state never becomes a server read contract", async () => {
  const files = await sourceFiles("src");
  for (const path of files.filter((file) => file.includes("/server/") || file.includes("/app/api/"))) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /\bPlanningShellState\b/, `${path} must return its use-case model`);
  }

  const state = await readFile("src/features/planning/model/planning-shell-state.ts", "utf8");
  assert.match(state, /Client-only composition state/);
  assert.match(state, /Never expose it from a server read interface/);
});
