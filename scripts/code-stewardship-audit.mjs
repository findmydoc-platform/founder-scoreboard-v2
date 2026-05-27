import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = ["src", "scripts", "tests", "supabase"];
const INCLUDED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".css",
  ".sql",
  ".md",
]);
const IGNORED_PARTS = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  "generated",
]);
const TASK_MARKERS = [
  ["TO", "DO"].join(""),
  ["FIX", "ME"].join(""),
  ["HA", "CK"].join(""),
];
const TASK_MARKER_PATTERN = new RegExp(
  `\\b(${TASK_MARKERS.join("|")})\\b`,
  "gi",
);

function walk(dir) {
  const entries = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_PARTS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      entries.push(...walk(fullPath));
      continue;
    }

    if (entry.isFile() && INCLUDED_EXTENSIONS.has(path.extname(entry.name))) {
      entries.push(fullPath);
    }
  }

  return entries;
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, "/");
}

function collectFiles() {
  return TARGET_DIRS.flatMap((dir) => {
    const fullPath = path.join(ROOT, dir);
    try {
      return statSync(fullPath).isDirectory() ? walk(fullPath) : [];
    } catch {
      return [];
    }
  });
}

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

const files = collectFiles();
const summaries = files.map((filePath) => {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const taskMarkers = [...text.matchAll(TASK_MARKER_PATTERN)].map((match) =>
    lineNumber(text, match.index ?? 0),
  );
  const debugLogs = [...text.matchAll(/\bconsole\.(log|debug|trace)\s*\(/g)].map(
    (match) => lineNumber(text, match.index ?? 0),
  );

  return {
    path: rel(filePath),
    lineCount: lines.length,
    taskMarkers,
    debugLogs,
  };
});

const largeFiles = summaries
  .filter((item) => item.lineCount >= 500)
  .sort((a, b) => b.lineCount - a.lineCount)
  .slice(0, 12);

const taskMarkerFiles = summaries.filter((item) => item.taskMarkers.length > 0);
const debugFiles = summaries.filter(
  (item) =>
    item.debugLogs.length > 0 &&
    !item.path.startsWith("scripts/") &&
    !item.path.startsWith("tests/"),
);

console.log("Code stewardship audit");
console.log("======================");
console.log(`Scanned ${files.length} files in ${TARGET_DIRS.join(", ")}.`);

console.log("\nLarge files (500+ lines)");
if (largeFiles.length === 0) {
  console.log("- none");
} else {
  for (const item of largeFiles) {
    console.log(`- ${item.path}: ${item.lineCount} lines`);
  }
}

console.log("\nTask markers");
if (taskMarkerFiles.length === 0) {
  console.log("- none");
} else {
  for (const item of taskMarkerFiles.slice(0, 20)) {
    console.log(`- ${item.path}: lines ${item.taskMarkers.slice(0, 8).join(", ")}`);
  }
}

console.log("\nDebug console calls outside scripts/tests");
if (debugFiles.length === 0) {
  console.log("- none");
} else {
  for (const item of debugFiles.slice(0, 20)) {
    console.log(`- ${item.path}: lines ${item.debugLogs.slice(0, 8).join(", ")}`);
  }
}

console.log("\nSuggested next step");
console.log(
  "Pick one hotspot, define the behavior contract, refactor in a small patch, then run the relevant checks.",
);
