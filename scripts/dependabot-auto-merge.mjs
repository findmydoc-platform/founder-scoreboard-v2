import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const DEPENDABOT_LOGINS = new Set(["app/dependabot", "dependabot[bot]"]);
const SUPPORTED_UPDATE_TYPES = new Set([
  "version-update:semver-minor",
  "version-update:semver-patch",
]);

export function parsePullRequestNumber(prCountJson) {
  if (!prCountJson) return null;

  const pullRequests = JSON.parse(prCountJson);
  const number = pullRequests?.[0]?.number;
  return Number.isInteger(number) ? number : null;
}

export function isDependabotAuthor(login) {
  return DEPENDABOT_LOGINS.has(login);
}

export function isSupportedUpdateType(updateType) {
  return SUPPORTED_UPDATE_TYPES.has(updateType);
}

export function firstSuccessfulValidationRunId(runsJson) {
  const runs = runsJson?.workflow_runs ?? [];
  return runs.find((run) => run.conclusion === "success")?.id ?? null;
}

export function requiredChecksAreGreen(checkRunsJson) {
  const checkRuns = checkRunsJson?.check_runs ?? [];
  const hasSuccessfulCheck = (name) =>
    checkRuns.some((checkRun) => checkRun.name === name && checkRun.conclusion === "success");

  return {
    preview: hasSuccessfulCheck("Deploy Preview"),
    validation: hasSuccessfulCheck("Dependency Validation"),
  };
}

function skip(reason, details = {}) {
  return { action: "skipped", reason, ...details };
}

function mergeablePrSkipReason(pr) {
  if (!isDependabotAuthor(pr?.author?.login)) {
    return `PR author is not Dependabot: ${pr?.author?.login ?? ""}`;
  }

  if (pr.baseRefName !== "main") {
    return `PR base is not main: ${pr.baseRefName ?? ""}`;
  }

  if (pr.state !== "OPEN") {
    return `PR is not open: ${pr.state ?? ""}`;
  }

  if (pr.mergeable !== "MERGEABLE" || pr.mergeStateStatus !== "CLEAN") {
    return `PR is not mergeable yet: mergeable=${pr.mergeable ?? ""} merge_state=${pr.mergeStateStatus ?? ""}`;
  }

  return null;
}

async function defaultGh(args) {
  try {
    const { stdout } = await execFile("gh", args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 10,
    });
    return stdout;
  } catch (error) {
    const stderr = error.stderr ? `\n${error.stderr}` : "";
    throw new Error(`gh ${args.join(" ")} failed${stderr}`);
  }
}

async function ghJson(gh, args) {
  const stdout = await gh(args);
  return JSON.parse(stdout);
}

async function downloadDependabotMetadata({ gh, repo, runId, prNumber, createWorkspace }) {
  const workspace = await createWorkspace();

  try {
    await gh([
      "run",
      "download",
      String(runId),
      "--repo",
      repo,
      "--name",
      `dependabot-metadata-pr-${prNumber}`,
      "--dir",
      workspace,
    ]);

    const metadata = await readFile(join(workspace, `pr-${prNumber}.json`), "utf8");
    return JSON.parse(metadata);
  } catch {
    return null;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function runDependabotAutoMerge({
  env = process.env,
  gh = defaultGh,
  log = console.log,
  createWorkspace = () => mkdtemp(join(tmpdir(), "dependabot-auto-merge-")),
} = {}) {
  const repo = env.REPO || env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("Missing REPO or GITHUB_REPOSITORY.");

  const prNumber = parsePullRequestNumber(env.PR_COUNT);
  if (!prNumber) {
    const result = skip("No pull request attached to workflow run.");
    log(result.reason);
    return result;
  }

  const pr = await ghJson(gh, [
    "pr",
    "view",
    String(prNumber),
    "--repo",
    repo,
    "--json",
    "author,baseRefName,headRefOid,mergeStateStatus,mergeable,state,url",
  ]);
  const prSkipReason = mergeablePrSkipReason(pr);
  if (prSkipReason) {
    const result = skip(prSkipReason, { prNumber });
    log(result.reason);
    return result;
  }

  const validationRuns = await ghJson(gh, [
    "api",
    `repos/${repo}/actions/workflows/dependency-validation.yml/runs?event=pull_request&head_sha=${pr.headRefOid}&status=completed&per_page=10`,
  ]);
  const runId = firstSuccessfulValidationRunId(validationRuns);
  if (!runId) {
    const result = skip(`No successful Dependency Validation run found for PR #${prNumber}.`, { prNumber });
    log(result.reason);
    return result;
  }

  const metadata = await downloadDependabotMetadata({
    gh,
    repo,
    runId,
    prNumber,
    createWorkspace,
  });

  if (!metadata) {
    const result = skip("Dependabot metadata artifact is unavailable.", { prNumber, runId });
    log(result.reason);
    return result;
  }

  if (!isSupportedUpdateType(metadata.update_type)) {
    const result = skip(`Unsupported update type: ${metadata.update_type ?? ""}`, { prNumber, runId });
    log(result.reason);
    return result;
  }

  const checks = await ghJson(gh, ["api", `repos/${repo}/commits/${pr.headRefOid}/check-runs`]);
  const checksGreen = requiredChecksAreGreen(checks);
  if (!checksGreen.preview || !checksGreen.validation) {
    const result = skip(
      `Required checks not green yet: preview=${checksGreen.preview} validation=${checksGreen.validation}`,
      { prNumber, runId },
    );
    log(result.reason);
    return result;
  }

  await gh(["pr", "merge", String(prNumber), "--repo", repo, "--squash", "--delete-branch"]);
  const result = { action: "merged", prNumber, runId };
  log(`Merged Dependabot PR #${prNumber}.`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runDependabotAutoMerge();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
