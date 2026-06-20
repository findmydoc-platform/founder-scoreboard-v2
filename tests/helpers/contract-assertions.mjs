import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function readContractFiles(pathsByKey) {
  const entries = await Promise.all(
    Object.entries(pathsByKey).map(async ([key, path]) => [key, await readFile(path, "utf8")]),
  );
  return Object.fromEntries(entries);
}

export function assertPatterns(source, patterns, label) {
  for (const pattern of patterns) {
    assert.match(source, pattern, `${label} should contain ${pattern}`);
  }
}

export function assertNoPatterns(source, patterns, label) {
  for (const pattern of patterns) {
    assert.doesNotMatch(source, pattern, `${label} should not contain ${pattern}`);
  }
}

export function assertPatternTable(rows) {
  for (const { label, source, matches = [], excludes = [] } of rows) {
    assertPatterns(source, matches, label);
    assertNoPatterns(source, excludes, label);
  }
}

export async function assertFileContracts(rows) {
  const rowsWithSources = await Promise.all(
    rows.map(async (row) => ({
      label: row.label || row.path,
      source: row.source || await readFile(row.path, "utf8"),
      matches: row.matches,
      excludes: row.excludes,
    })),
  );
  assertPatternTable(rowsWithSources);
}
