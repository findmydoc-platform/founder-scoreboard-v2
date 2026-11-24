import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  applyApprovedMigrations,
  parseApprovedMigrationPlan,
  verifyApprovedMigrationDryRun,
  verifyApprovedMigrationFiles,
  verifyInOrderPendingMigrations,
  verifyProductionMigrationSource,
} from "../../scripts/lib/deploy-production-migration-plan.mjs";
import { listSupabaseMigrations } from "../../scripts/lib/supabase-migrations.mjs";

const initial = "20260827064853";
const earlier = "20261113050014";
const later = "20261113080000";
const makeFile = (version: string, name: string) => {
  const sql = `select '${name}';\n`;
  return {
    version, file: `${version}_${name}.sql`, sql, sha256: createHash("sha256").update(sql).digest("hex"),
  };
};
const applied = [makeFile(initial, "baseline"), makeFile(later, "later")];
const pending = makeFile(earlier, "planning_source_version_observation");
const files = [applied[0], pending, applied[1]];
const manifest = {
  version: 1, base: "1".repeat(40), head: "2".repeat(40), tree: "3".repeat(40),
  pullRequest: 680,
  ledger: [initial, later], pending: [{ file: pending.file, sha256: pending.sha256 }],
};
const plan = parseApprovedMigrationPlan(JSON.stringify(manifest));

describe("approved production migration plan", () => {
  it("binds an explicit one-file approval to the exact ledger and SQL bytes", () => {
    expect(verifyApprovedMigrationFiles(plan, files, [initial, later])).toEqual([pending]);
    expect(() => verifyApprovedMigrationFiles(plan, files, [initial])).toThrow("live ledger differs");
    expect(() => verifyApprovedMigrationFiles(plan, files, [initial, earlier, later])).toThrow("live ledger differs");
    const changed = { ...pending, sha256: "0".repeat(64) };
    expect(() => verifyApprovedMigrationFiles(plan, [applied[0], changed, applied[1]], [initial, later]))
      .toThrow("pending file names or checksums differ");
    const extra = makeFile("20261113060000", "unapproved");
    expect(() => verifyApprovedMigrationFiles(plan, [applied[0], pending, extra, applied[1]], [initial, later]))
      .toThrow("pending file names or checksums differ");
  });

  it("allows no-op and ordinary younger pending migrations without a manifest", () => {
    expect(verifyInOrderPendingMigrations(files, [initial, earlier, later])).toEqual([]);
    expect(verifyInOrderPendingMigrations(files, [initial, earlier])).toEqual([applied[1]]);
    expect(() => verifyInOrderPendingMigrations(files, [initial, later])).toThrow("out-of-order pending migrations require explicit approval");
  });

  it("rejects unbounded or reordered approvals and dry-run output", () => {
    expect(() => parseApprovedMigrationPlan(JSON.stringify({ ...manifest, ledger: [later, initial] })))
      .toThrow("invalid expected ledger");
    expect(() => parseApprovedMigrationPlan(JSON.stringify({ ...manifest, pending: [] })))
      .toThrow("invalid approved pending files");
    expect(() => parseApprovedMigrationPlan(JSON.stringify({ ...manifest, includeAll: true })))
      .toThrow("invalid manifest fields");
    expect(() => verifyApprovedMigrationDryRun(` • ${pending.file}\n`, [pending])).not.toThrow();
    expect(() => verifyApprovedMigrationDryRun(` • ${pending.file}\n • ${applied[0].file}\n`, [pending]))
      .toThrow("CLI dry-run file order");
    expect(() => verifyApprovedMigrationDryRun(` • ${applied[1].file}\n • ${pending.file}\n`, [pending, applied[1]]))
      .toThrow("CLI dry-run file order");
  });

  it("binds the approval to the pushed tree while allowing a different squash commit ID", async () => {
    const root = await mkdtemp(join(tmpdir(), "founderops-approval-test-"));
    const remote = join(root, "remote.git");
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=test@example.invalid", "-c", "user.name=Test", ...args], { cwd: root, encoding: "utf8" }).trim();
    try {
      git("init", "-q");
      git("init", "--bare", "-q", remote);
      const migrations = join(root, "supabase", "migrations");
      await mkdir(migrations, { recursive: true });
      for (const migration of applied) {
        await writeFile(join(migrations, migration.file), migration.sql);
      }
      git("add", "supabase/migrations");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      await writeFile(join(migrations, pending.file), pending.sql);
      git("add", "supabase/migrations");
      git("commit", "-qm", "approved candidate");
      const head = git("rev-parse", "HEAD");
      const tree = git("rev-parse", "HEAD^{tree}");
      const repo = "findmydoc-platform/founder-scoreboard-v2";
      const url = `https://github.com/${repo}`;
      git("push", "-q", remote, `${head}:refs/pull/680/head`);
      git("remote", "add", "origin", url);
      git("config", `url.${remote}.insteadOf`, url);
      git("reset", "--soft", base);
      git("commit", "-qm", "squashed release commit");
      const sha = git("rev-parse", "HEAD");
      const env = { GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY: repo, GITHUB_REF: "refs/heads/main", GITHUB_SHA: sha };
      const event = { before: base, after: sha, ref: "refs/heads/main" };
      const verify = { plan: { ...plan, base, head, tree }, root, env, event };
      expect(head).not.toBe(sha);
      await expect(verifyProductionMigrationSource(verify)).resolves.toBeUndefined();
      await expect(verifyProductionMigrationSource({ ...verify, plan: null }))
        .rejects.toThrow("out-of-order migration change requires explicit approval");
      await expect(verifyProductionMigrationSource({ ...verify, event: { ...event, before: head } }))
        .rejects.toThrow("unexpected production push");
      await expect(verifyProductionMigrationSource({ ...verify, plan: { ...verify.plan, tree: "a".repeat(40) } }))
        .rejects.toThrow("checkout does not match");
      await expect(verifyProductionMigrationSource({ ...verify, plan: { ...verify.plan, head: sha } }))
        .rejects.toThrow("GitHub pull request head differs");
      await writeFile(join(migrations, "20261113090000_unexpected.sql"), "select 1;");
      await expect(verifyProductionMigrationSource(verify)).rejects.toThrow("migration directory differs");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never starts apply when ledger changes after dry run", async () => {
    const checkLedgerAndLocks = vi.fn().mockResolvedValueOnce([initial, later]).mockResolvedValueOnce([initial]);
    const runCli = vi.fn().mockResolvedValue(` • ${pending.file}\n`);
    await expect(applyApprovedMigrations({ plan, migrations: files, checkLedgerAndLocks, runCli }))
      .rejects.toThrow("live ledger differs");
    expect(runCli).toHaveBeenCalledTimes(1);
    expect(runCli.mock.calls[0][0]).toContain("--dry-run");
  });

  it("uses identical approved SQL and blocks replay of previously applied versions", async () => {
    const checkLedgerAndLocks = vi.fn()
      .mockResolvedValueOnce([initial, later]).mockResolvedValueOnce([initial, later])
      .mockResolvedValueOnce([initial, earlier, later]);
    const runCli = vi.fn(async (args: string[]) => {
      const [workdirFlag, root, includeAll, yes, ...rest] = args;
      expect([workdirFlag, includeAll, yes]).toEqual(["--workdir", "--include-all", "--yes"]);
      expect(rest).toEqual(runCli.mock.calls.length === 1 ? ["--dry-run"] : []);
      const staged = await listSupabaseMigrations(root);
      expect(staged.map(({ file }) => file)).toEqual(files.map(({ file }) => file));
      expect(staged[1]).toMatchObject({ sql: pending.sql, sha256: pending.sha256 });
      expect(staged[0].sql).toContain("Refusing to replay an applied migration");
      expect(staged[2].sql).toContain("Refusing to replay an applied migration");
      return ` • ${pending.file}\n`;
    });
    await expect(applyApprovedMigrations({ plan, migrations: files, checkLedgerAndLocks, runCli })).resolves.toBeUndefined();
    expect(runCli).toHaveBeenCalledTimes(2);
    expect(checkLedgerAndLocks).toHaveBeenCalledTimes(3);
  });
});
