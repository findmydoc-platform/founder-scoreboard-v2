#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { extname } from "node:path";

const reviewerDefinitions = [
  {
    name: "contract_stability_reviewer",
    priority: 50,
    reason: "Changed API, persistence, migration, exported-type, workflow, or provider contracts.",
  },
  {
    name: "logic_state_reviewer",
    priority: 40,
    reason: "Changed executable production logic, state, side effects, or error paths.",
  },
  {
    name: "module_boundary_reviewer",
    priority: 30,
    reason: "Changed module ownership, dependency configuration, shared code, or file boundaries.",
  },
  {
    name: "test_quality_reviewer",
    priority: 20,
    reason: "Changed production behavior or tests require regression-strength review.",
  },
  {
    name: "minimal_change_reviewer",
    priority: 10,
    reason: "Added, deleted, or dependency-affecting surface may have a smaller equivalent.",
  },
];

function usage() {
  return [
    "Usage: pnpm run review:route -- [options]",
    "",
    "Options:",
    "  --base <ref>          Comparison ref (default: origin/main)",
    "  --head <ref>          Reviewed head (default: HEAD)",
    "  --format <text|json>  Output format (default: text)",
    "  --help                Show this help",
  ].join("\n");
}

function parseArguments(rawArguments) {
  const args = rawArguments[0] === "--" ? rawArguments.slice(1) : [...rawArguments];
  const options = {
    base: "origin/main",
    head: "HEAD",
    format: "text",
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--help") {
      options.help = true;
      continue;
    }

    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);

    if (!["--base", "--head", "--format"].includes(key)) {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const value = inlineValue ?? args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }

    options[key.slice(2)] = value;
  }

  if (!["text", "json"].includes(options.format)) {
    throw new Error("--format must be text or json");
  }

  return options;
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const message = result.stderr.toString("utf8").trim();
    throw new Error(message || `git ${args[0]} failed with exit code ${result.status}`);
  }

  return result.stdout;
}

function gitText(args, cwd) {
  return runGit(args, cwd).toString("utf8").trim();
}

function parseNameStatus(buffer, layer) {
  const fields = buffer.toString("utf8").split("\0");
  if (fields.at(-1) === "") {
    fields.pop();
  }

  const entries = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index];
    index += 1;

    if (/^[RC]\d+$/.test(status)) {
      const previousPath = fields[index];
      const path = fields[index + 1];
      index += 2;
      entries.push({ layer, path, previousPath, status });
      continue;
    }

    const path = fields[index];
    index += 1;
    entries.push({ layer, path, status });
  }

  return entries;
}

function mergeEntries(entries) {
  const byPath = new Map();

  for (const entry of entries) {
    const current = byPath.get(entry.path) ?? {
      path: entry.path,
      previousPaths: new Set(),
      statuses: new Set(),
      layers: new Set(),
    };

    current.statuses.add(entry.status);
    current.layers.add(entry.layer);
    if (entry.previousPath) {
      current.previousPaths.add(entry.previousPath);
    }
    byPath.set(entry.path, current);
  }

  return [...byPath.values()]
    .map((entry) => ({
      path: entry.path,
      ...(entry.previousPaths.size > 0 ? { previousPaths: [...entry.previousPaths].sort() } : {}),
      statuses: [...entry.statuses].sort(),
      layers: [...entry.layers].sort(),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function isTestPath(path) {
  return (
    /(^|\/)(__tests__|tests?)(\/|$)/.test(path) ||
    /\.(spec|test)\.[cm]?[jt]sx?$/.test(path) ||
    /\.stories\.[cm]?[jt]sx?$/.test(path)
  );
}

function isDocumentationPath(path) {
  if (/(^|\/)AGENTS\.md$/.test(path)) {
    return false;
  }

  return path.startsWith("docs/") || path.endsWith(".md");
}

function isExecutableProductionPath(path) {
  if (isTestPath(path) || isDocumentationPath(path)) {
    return false;
  }

  return [".cjs", ".js", ".jsx", ".mjs", ".sql", ".ts", ".tsx"].includes(extname(path));
}

function isDependencyOrToolingPath(path) {
  return (
    /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json)$/.test(path) ||
    /(^|\/)(eslint|knip|next|postcss|tailwind|vercel)\.config\.[^/]+$/.test(path) ||
    path.startsWith(".github/workflows/") ||
    path.startsWith(".codex/") ||
    /(^|\/)AGENTS\.md$/.test(path)
  );
}

function isContractPath(path) {
  return (
    /(^|\/)(api|routes?|webhooks?)(\/|$)/.test(path) ||
    path.startsWith("supabase/") ||
    /(^|\/)(schema|types?|contracts?)(\/|\.|$)/.test(path) ||
    /(^|\/)(github|providers?|adapters?)(\/|$)/.test(path) ||
    path.startsWith(".github/workflows/")
  );
}

function moduleRoots(paths) {
  const roots = new Set();

  for (const path of paths) {
    const feature = path.match(/^src\/features\/([^/]+)/)?.[1];
    if (feature) {
      roots.add(`feature:${feature}`);
    }
    if (/^src\/(lib|shared|server)\//.test(path)) {
      roots.add(path.split("/").slice(0, 2).join(":"));
    }
  }

  return roots;
}

function collectRiskSignals(files) {
  const allPaths = files.flatMap((file) => [file.path, ...(file.previousPaths ?? [])]);
  const productionPaths = files.filter((file) => isExecutableProductionPath(file.path)).map((file) => file.path);
  const testPaths = files.filter((file) => isTestPath(file.path)).map((file) => file.path);
  const contractPaths = files.filter((file) => isContractPath(file.path)).map((file) => file.path);
  const dependencyPaths = files.filter((file) => isDependencyOrToolingPath(file.path)).map((file) => file.path);
  const addedOrDeletedPaths = files
    .filter(
      (file) =>
        !isDocumentationPath(file.path) &&
        !isTestPath(file.path) &&
        file.statuses.some((status) => status === "A" || status === "D" || status === "??"),
    )
    .map((file) => file.path);
  const movedPaths = files
    .filter((file) => file.statuses.some((status) => /^[RC]\d+$/.test(status)))
    .map((file) => file.path);
  const roots = moduleRoots(allPaths);
  const boundaryPaths =
    movedPaths.length > 0 || roots.size > 1 || dependencyPaths.length > 0
      ? [...new Set([...movedPaths, ...dependencyPaths, ...allPaths.filter((path) => /^src\/(lib|shared|server)\//.test(path))])]
      : [];

  return [
    { id: "contract_surface", paths: contractPaths },
    { id: "executable_production", paths: productionPaths },
    { id: "module_boundary", paths: boundaryPaths },
    { id: "test_surface", paths: testPaths },
    { id: "surface_growth_or_removal", paths: [...new Set([...addedOrDeletedPaths, ...dependencyPaths])] },
  ].filter((signal) => signal.paths.length > 0);
}

function routeReviewers(files, riskSignals) {
  const signalIds = new Set(riskSignals.map((signal) => signal.id));
  const relevantNames = new Set();

  if (signalIds.has("contract_surface")) {
    relevantNames.add("contract_stability_reviewer");
  }
  if (signalIds.has("executable_production")) {
    relevantNames.add("logic_state_reviewer");
    relevantNames.add("test_quality_reviewer");
  }
  if (signalIds.has("module_boundary")) {
    relevantNames.add("module_boundary_reviewer");
  }
  if (signalIds.has("test_surface")) {
    relevantNames.add("test_quality_reviewer");
  }
  if (signalIds.has("surface_growth_or_removal")) {
    relevantNames.add("minimal_change_reviewer");
  }

  const relevant = reviewerDefinitions
    .filter((reviewer) => relevantNames.has(reviewer.name))
    .sort((left, right) => right.priority - left.priority);
  const recommended = relevant.slice(0, 3);
  const overflow = new Set(relevant.slice(3).map((reviewer) => reviewer.name));

  return {
    recommendedReviewers: recommended.map(({ name, reason }) => ({ name, reason })),
    omittedReviewers: reviewerDefinitions
      .filter((reviewer) => !recommended.some((selected) => selected.name === reviewer.name))
      .map(({ name, reason }) => ({
        name,
        reason: overflow.has(name)
          ? `Relevant candidate omitted by the three-reviewer default: ${reason}`
          : "No matching changed path or risk signal.",
      })),
  };
}

function buildReport(options) {
  const repositoryRoot = gitText(["rev-parse", "--show-toplevel"], process.cwd());
  const base = gitText(["rev-parse", "--verify", `${options.base}^{commit}`], repositoryRoot);
  const head = gitText(["rev-parse", "--verify", `${options.head}^{commit}`], repositoryRoot);
  const mergeBase = gitText(["merge-base", base, head], repositoryRoot);

  const entries = [
    ...parseNameStatus(runGit(["diff", "--name-status", "-z", "-M", mergeBase, head], repositoryRoot), "committed"),
    ...parseNameStatus(runGit(["diff", "--cached", "--name-status", "-z", "-M"], repositoryRoot), "staged"),
    ...parseNameStatus(runGit(["diff", "--name-status", "-z", "-M"], repositoryRoot), "unstaged"),
  ];
  const untracked = runGit(["ls-files", "--others", "--exclude-standard", "-z"], repositoryRoot)
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => ({ layer: "untracked", path, status: "??" }));

  const changedFiles = mergeEntries([...entries, ...untracked]);
  const riskSignals = collectRiskSignals(changedFiles);
  const routing = routeReviewers(changedFiles, riskSignals);

  return {
    base: { requested: options.base, revision: base },
    mergeBase,
    head: { requested: options.head, revision: head },
    workingTree: {
      staged: changedFiles.filter((file) => file.layers.includes("staged")).length,
      unstaged: changedFiles.filter((file) => file.layers.includes("unstaged")).length,
      untracked: changedFiles.filter((file) => file.layers.includes("untracked")).length,
    },
    changedFiles,
    riskSignals,
    ...routing,
  };
}

function formatText(report) {
  const lines = [
    `Review target: ${report.base.requested} (${report.mergeBase})...${report.head.requested} (${report.head.revision})`,
    `Changed files: ${report.changedFiles.length}`,
    `Working tree: ${report.workingTree.staged} staged, ${report.workingTree.unstaged} unstaged, ${report.workingTree.untracked} untracked`,
    "",
    "Recommended reviewers:",
  ];

  if (report.recommendedReviewers.length === 0) {
    lines.push("- none");
  } else {
    for (const reviewer of report.recommendedReviewers) {
      lines.push(`- ${reviewer.name}: ${reviewer.reason}`);
    }
  }

  lines.push("", "Omitted reviewers:");
  for (const reviewer of report.omittedReviewers) {
    lines.push(`- ${reviewer.name}: ${reviewer.reason}`);
  }

  lines.push("", "Changed files:");
  if (report.changedFiles.length === 0) {
    lines.push("- none");
  } else {
    for (const file of report.changedFiles) {
      const previous = file.previousPaths ? ` from ${file.previousPaths.join(", ")}` : "";
      lines.push(`- ${file.path}${previous} [${file.statuses.join(", ")}; ${file.layers.join(", ")}]`);
    }
  }

  return lines.join("\n");
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  const report = buildReport(options);
  const output = options.format === "json" ? JSON.stringify(report, null, 2) : formatText(report);
  process.stdout.write(`${output}\n`);
} catch (error) {
  process.stderr.write(`review:route failed: ${error.message}\n`);
  process.stderr.write(`${usage()}\n`);
  process.exit(1);
}
