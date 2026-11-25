import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { listSupabaseMigrations, migrationFilePattern } from "./supabase-migrations.mjs";

const git = promisify(execFile);
const gitObject = /^[a-f0-9]{40}$/;
const sha256 = /^[a-f0-9]{64}$/;
const migrationVersion = /^\d{14}$/;
const migrationPath = "supabase/migrations";
const productionRef = "refs/heads/main";
const repository = "findmydoc-platform/founder-scoreboard-v2";
const blockedReplay = "do $$ begin raise exception 'Refusing to replay an applied migration'; end $$;\n";

function rejectUnless(condition, message) {
  if (!condition) throw new Error(`Refusing approved migration plan: ${message}.`);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sortedUnique(values) {
  return same(values, [...new Set(values)].sort());
}

export function parseApprovedMigrationPlan(json) {
  let plan;
  try {
    plan = JSON.parse(json);
  } catch {
    throw new Error("Refusing approved migration plan: invalid manifest JSON.");
  }
  rejectUnless(
    plan && same(Object.keys(plan).sort(), ["base", "head", "ledger", "pending", "pullRequest", "tree", "version"]),
    "invalid manifest fields",
  );
  rejectUnless(plan.version === 1, "unknown manifest version");
  rejectUnless(Number.isSafeInteger(plan.pullRequest) && plan.pullRequest > 0, "invalid approved pull request");
  rejectUnless([plan.base, plan.head, plan.tree].every((sha) => typeof sha === "string" && gitObject.test(sha)), "invalid Git binding");
  rejectUnless(plan.base !== plan.head, "identical base and head");
  rejectUnless(
    Array.isArray(plan.ledger) && plan.ledger.length > 0
      && plan.ledger.every((value) => typeof value === "string" && migrationVersion.test(value)) && sortedUnique(plan.ledger),
    "invalid expected ledger",
  );
  rejectUnless(
    Array.isArray(plan.pending) && plan.pending.length > 0
      && plan.pending.every((row) => row && same(Object.keys(row).sort(), ["file", "sha256"])
        && migrationFilePattern.test(row.file) && sha256.test(row.sha256))
      && sortedUnique(plan.pending.map(({ file }) => file)),
    "invalid approved pending files",
  );
  return plan;
}

export async function verifyProductionMigrationSource({ plan, root, env, event }) {
  const resolve = async (...args) => (await git("git", args, { cwd: root })).stdout.trim();
  rejectUnless(env.GITHUB_REPOSITORY === repository && env.GITHUB_REF === productionRef && gitObject.test(env.GITHUB_SHA), "unexpected production workflow checkout");
  rejectUnless(same(await resolve("show", "-s", "--format=%H", "HEAD"), env.GITHUB_SHA), "checkout does not match the workflow SHA");
  rejectUnless(!await resolve("status", "--porcelain", "--untracked-files=all", "--", migrationPath), "migration directory differs from the workflow checkout");
  const parents = (await resolve("show", "-s", "--format=%P", "HEAD")).split(" ");
  const push = env.GITHUB_EVENT_NAME === "push";
  rejectUnless(
    push
      ? event.ref === productionRef && gitObject.test(event.before) && event.after === env.GITHUB_SHA && !event.forced && !event.deleted
      : env.GITHUB_EVENT_NAME === "workflow_dispatch" && gitObject.test(parents[0]),
    "unexpected production event",
  );
  if (!plan) {
    const previous = push ? event.before : parents[0];
    const previousFiles = await resolve("ls-tree", "-r", "--name-only", previous, "--", migrationPath);
    const added = await resolve("diff", "--name-only", "--diff-filter=A", previous, env.GITHUB_SHA, "--", migrationPath);
    const versions = (files) => files.split("\n").flatMap((file) => {
      const version = file.split("/").at(-1).match(migrationFilePattern)?.[1];
      return version ? [version] : [];
    });
    const latest = versions(previousFiles).sort().at(-1);
    rejectUnless(!latest || versions(added).every((version) => version > latest), "an out-of-order migration change requires explicit approval");
    return;
  }
  rejectUnless(push && event.before === plan.base, "unexpected production push event or previous main");
  rejectUnless(same(parents, [plan.base]) || same(parents, [plan.base, plan.head]), "production commit parents differ from the approved base and head");
  const tree = await resolve("rev-parse", "HEAD^{tree}");
  rejectUnless(tree === plan.tree, "checkout does not match the approved merge tree");
  const origin = await resolve("config", "--local", "--get", "remote.origin.url");
  rejectUnless(origin === `https://github.com/${repository}` || origin === `https://github.com/${repository}.git`, "unexpected production repository remote");
  try {
    await resolve("fetch", "--no-tags", "--no-recurse-submodules", "origin", `refs/pull/${plan.pullRequest}/head`);
  } catch {
    throw new Error("Refusing approved migration plan: could not resolve the GitHub pull request head.");
  }
  rejectUnless(await resolve("rev-parse", "FETCH_HEAD") === plan.head, "GitHub pull request head differs from the approval");
  const merged = await resolve("merge-tree", "--write-tree", plan.base, plan.head);
  rejectUnless(merged === plan.tree, "approval does not match the clean merge of its base and head");
}

function getPendingMigrations(migrations, appliedVersions) {
  const versions = migrations.map(({ version }) => version);
  rejectUnless(versions.every((value) => migrationVersion.test(value)) && sortedUnique(versions), "invalid migration directory");
  const all = new Set(versions);
  rejectUnless(appliedVersions.every((version) => all.has(version)), "live ledger contains unknown versions");
  const applied = new Set(appliedVersions);
  return migrations.filter((migration) => !applied.has(migration.version));
}

export function verifyInOrderPendingMigrations(migrations, appliedVersions) {
  const pending = getPendingMigrations(migrations, appliedVersions);
  const latest = appliedVersions.at(-1);
  rejectUnless(!latest || pending.every(({ version }) => version > latest), "out-of-order pending migrations require explicit approval");
  return pending;
}

export function verifyApprovedMigrationFiles(plan, migrations, appliedVersions) {
  rejectUnless(same(appliedVersions, plan.ledger), "live ledger differs from the approval");
  const pending = getPendingMigrations(migrations, appliedVersions);
  rejectUnless(
    same(pending.map(({ file, sha256: digest }) => [file, digest]), plan.pending.map(({ file, sha256: digest }) => [file, digest])),
    "pending file names or checksums differ from the approval",
  );
  return pending;
}

export function verifyApprovedMigrationDryRun(output, pending) {
  const lines = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split("\n");
  const files = lines.flatMap((line) => [...line.matchAll(/\b(\d{14}_[a-z0-9_]+\.sql)\b/g)].map((match) => match[1]));
  rejectUnless(same(files, pending.map(({ file }) => file)), "CLI dry-run file order differs from the approval");
}

function migrationRecords(migrations) {
  return migrations.map(({ file, version, sha256: digest }) => [file, version, digest]);
}

export async function applyApprovedMigrations({ plan, migrations, checkLedgerAndLocks, runCli }) {
  const readBefore = async () => verifyApprovedMigrationFiles(plan, migrations, await checkLedgerAndLocks());
  const pending = await readBefore();
  const pendingFiles = new Set(pending.map(({ file }) => file));
  const isolated = await mkdtemp(join(tmpdir(), "founderops-migration-"));
  const directory = join(isolated, "supabase", "migrations");
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const migration of migrations) {
      const sql = pendingFiles.has(migration.file) ? migration.sql : blockedReplay;
      await writeFile(join(directory, migration.file), sql, { mode: 0o400, flag: "wx" });
    }
    await chmod(directory, 0o500);
    const baseline = migrationRecords(await listSupabaseMigrations(isolated));
    const workdir = ["--workdir", isolated, "--include-all", "--yes"];
    const dry = await runCli([...workdir, "--dry-run"]);
    verifyApprovedMigrationDryRun(dry, pending);
    rejectUnless(same(baseline, migrationRecords(await listSupabaseMigrations(isolated))), "isolated migration files changed");
    await readBefore();
    await runCli(workdir);
    const nextLedger = [...migrations.map(({ version }) => version)].sort();
    rejectUnless(same(await checkLedgerAndLocks(), nextLedger), "final live ledger differs from the exact expected result");
  } finally {
    await chmod(directory, 0o700).catch(() => {});
    await rm(isolated, { force: true, recursive: true });
  }
}
