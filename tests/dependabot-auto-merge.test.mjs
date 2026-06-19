import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parsePullRequestNumber,
  requiredChecksAreGreen,
  runDependabotAutoMerge,
} from "../scripts/dependabot-auto-merge.mjs";

const repo = "findmydoc-platform/founder-scoreboard-v2";

function dependabotPr(overrides = {}) {
  return {
    author: { login: "app/dependabot" },
    baseRefName: "main",
    headRefOid: "abc123",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    state: "OPEN",
    url: "https://github.com/findmydoc-platform/founder-scoreboard-v2/pull/24",
    ...overrides,
  };
}

function greenChecks() {
  return {
    check_runs: [
      { name: "Deploy Preview", conclusion: "success" },
      { name: "Dependency Validation", conclusion: "success" },
    ],
  };
}

function autoMergeEnv(prNumber = 24) {
  return {
    REPO: repo,
    PR_COUNT: JSON.stringify([{ number: prNumber }]),
  };
}

function createGhMock({
  pr = dependabotPr(),
  validationRuns = { workflow_runs: [{ id: 123, conclusion: "success" }] },
  checks = greenChecks(),
  metadata = { update_type: "version-update:semver-patch" },
  failMetadataDownload = false,
} = {}) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);

    if (args[0] === "pr" && args[1] === "view") return JSON.stringify(pr);
    if (args[0] === "api" && args[1].includes("/actions/workflows/dependency-validation.yml/runs")) {
      return JSON.stringify(validationRuns);
    }
    if (args[0] === "api" && args[1].includes("/check-runs")) return JSON.stringify(checks);
    if (args[0] === "pr" && args[1] === "merge") return "";
    if (args[0] === "run" && args[1] === "download") {
      if (failMetadataDownload) throw new Error("no valid artifacts found to download");

      const dir = args[args.indexOf("--dir") + 1];
      const artifactName = args[args.indexOf("--name") + 1];
      const prNumber = artifactName.match(/dependabot-metadata-pr-(\d+)/)?.[1];
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `pr-${prNumber}.json`), JSON.stringify(metadata));
      return "";
    }

    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };

  return { calls, gh };
}

test("parses the triggering pull request number from workflow_run payload", () => {
  assert.equal(parsePullRequestNumber(JSON.stringify([{ number: 33 }])), 33);
  assert.equal(parsePullRequestNumber("[]"), null);
});

test("checks require both preview and dependency validation to be green", () => {
  assert.deepEqual(requiredChecksAreGreen(greenChecks()), { preview: true, validation: true });
  assert.deepEqual(
    requiredChecksAreGreen({ check_runs: [{ name: "Dependency Validation", conclusion: "success" }] }),
    { preview: false, validation: true },
  );
});

test("skips human-authored pull requests before metadata lookup", async () => {
  const { calls, gh } = createGhMock({
    pr: dependabotPr({ author: { login: "SebastianSchuetze" } }),
  });

  const result = await runDependabotAutoMerge({
    env: autoMergeEnv(33),
    gh,
    log: () => {},
  });

  assert.equal(result.action, "skipped");
  assert.match(result.reason, /not Dependabot/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ["pr", "view", "33"]);
});

test("missing metadata artifact becomes a skip instead of a failed run", async () => {
  const { calls, gh } = createGhMock({ failMetadataDownload: true });

  const result = await runDependabotAutoMerge({
    env: autoMergeEnv(24),
    gh,
    log: () => {},
    createWorkspace: () => mkdtemp(join(tmpdir(), "dependabot-test-")),
  });

  assert.equal(result.action, "skipped");
  assert.equal(result.reason, "Dependabot metadata artifact is unavailable.");
  assert.equal(calls.some((call) => call[0] === "pr" && call[1] === "merge"), false);
});

test("green supported Dependabot updates are merged through gh with explicit repo", async () => {
  const { calls, gh } = createGhMock();

  const result = await runDependabotAutoMerge({
    env: autoMergeEnv(24),
    gh,
    log: () => {},
    createWorkspace: () => mkdtemp(join(tmpdir(), "dependabot-test-")),
  });

  assert.equal(result.action, "merged");
  const mergeCall = calls.find((call) => call[0] === "pr" && call[1] === "merge");
  assert.deepEqual(mergeCall, ["pr", "merge", "24", "--repo", repo, "--squash", "--delete-branch"]);
});
