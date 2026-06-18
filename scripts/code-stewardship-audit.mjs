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
const LARGE_FILE_EXCEPTIONS = new Set([
  "src/features/planning/hooks/use-planning-app-controller.ts",
]);
const APPROVED_NATIVE_CONTROL_FILES = new Set([
  "src/shared/atoms/custom-select.tsx",
  "src/shared/atoms/custom-date-picker.tsx",
]);
const FORBIDDEN_STRUCTURE_DIRECTORIES = [
  "src/components",
  "src/hooks",
];
const LEGACY_IMPORT_PATTERNS = [
  { label: "@/components", pattern: /(?:from\s+|import\s*\(\s*)["']@\/components(?:\/|["'])/ },
  { label: "@/hooks", pattern: /(?:from\s+|import\s*\(\s*)["']@\/hooks(?:\/|["'])/ },
  { label: "src/components", pattern: /(?:from\s+|import\s*\(\s*)["']src\/components(?:\/|["'])/ },
  { label: "src/hooks", pattern: /(?:from\s+|import\s*\(\s*)["']src\/hooks(?:\/|["'])/ },
];
const NATIVE_CONTROL_PATTERNS = [
  { label: "<select>", pattern: /<select\b/ },
  { label: "</select>", pattern: /<\/select>/ },
  { label: "<option>", pattern: /<option\b/ },
  { label: "input type=date", pattern: /type=["']date["']/ },
  { label: "input type=datetime-local", pattern: /type=["']datetime-local["']/ },
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
    extension: path.extname(filePath),
    lineCount: lines.length,
    taskMarkers,
    debugLogs,
    text,
  };
});

const largeFiles = summaries
  .filter((item) => item.lineCount >= 500)
  .sort((a, b) => b.lineCount - a.lineCount)
  .slice(0, 12);
const largeFileWarnings = largeFiles.filter(
  (item) => !LARGE_FILE_EXCEPTIONS.has(item.path),
);
const knownLargeFiles = largeFiles.filter((item) =>
  LARGE_FILE_EXCEPTIONS.has(item.path),
);

const taskMarkerFiles = summaries.filter((item) => item.taskMarkers.length > 0);
const debugFiles = summaries.filter(
  (item) =>
    item.debugLogs.length > 0 &&
    !item.path.startsWith("scripts/") &&
    !item.path.startsWith("tests/"),
);
const forbiddenStructureDirectories = FORBIDDEN_STRUCTURE_DIRECTORIES.filter((dir) => {
  try {
    return statSync(path.join(ROOT, dir)).isDirectory();
  } catch {
    return false;
  }
});
const sourceSummaries = summaries.filter((item) => item.path.startsWith("src/"));
const legacyImportViolations = sourceSummaries.flatMap((item) =>
  LEGACY_IMPORT_PATTERNS.filter(({ pattern }) => pattern.test(item.text)).map(
    ({ label }) => `${item.path}: imports ${label}`,
  ),
);
const nativeControlViolations = sourceSummaries
  .filter((item) => item.extension === ".tsx")
  .filter((item) => !APPROVED_NATIVE_CONTROL_FILES.has(item.path))
  .flatMap((item) =>
    NATIVE_CONTROL_PATTERNS.filter(({ pattern }) => pattern.test(item.text)).map(
      ({ label }) => `${item.path}: uses ${label}`,
    ),
  );
const guardViolations = [
  ...forbiddenStructureDirectories.map((dir) => `${dir}: forbidden global UI directory`),
  ...legacyImportViolations,
  ...nativeControlViolations,
];

console.log("Code stewardship audit");
console.log("======================");
console.log(`Scanned ${files.length} files in ${TARGET_DIRS.join(", ")}.`);

console.log("\nLarge files (500+ lines, warnings only)");
if (largeFileWarnings.length === 0) {
  console.log("- none");
} else {
  for (const item of largeFileWarnings) {
    console.log(`- ${item.path}: ${item.lineCount} lines`);
  }
}

console.log("\nKnown large-file exceptions");
if (knownLargeFiles.length === 0) {
  console.log("- none");
} else {
  for (const item of knownLargeFiles) {
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

console.log("\nStructure guard violations");
if (guardViolations.length === 0) {
  console.log("- none");
} else {
  for (const violation of guardViolations.slice(0, 40)) {
    console.log(`- ${violation}`);
  }
}

console.log("\nSuggested next step");
console.log(
  "Pick one hotspot, define the behavior contract, refactor in a small patch, then run the relevant checks.",
);

if (guardViolations.length > 0) {
  process.exitCode = 1;
}
