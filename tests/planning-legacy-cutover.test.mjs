import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [script, runbook, packageJson] = await Promise.all([
  readFile("scripts/verify-planning-legacy-cutover.mjs", "utf8"),
  readFile("docs/planning-legacy-cutover-runbook.md", "utf8"),
  readFile("package.json", "utf8"),
]);

test("planning legacy preflight is local-only, read-only, and fail closed", () => {
  assert.match(script, /target !== "--local"/);
  assert.match(script, /begin read only isolation level repeatable read/);
  assert.match(script, /--parity/);
  assert.match(script, /--ready-to-drop/);
  assert.match(script, /process\.exitCode = 1/);
  assert.doesNotMatch(script, /delete from|truncate\b|drop table|alter table/i);
  assert.match(packageJson, /verify:planning-legacy-cutover/);
});

test("planning legacy preflight covers every destructive cutover data boundary", () => {
  for (const boundary of [
    "Milestone row count and mapping",
    "Milestone field parity",
    "Package row count and mapping",
    "Package fields, parent, approval, trash, and strategy parity",
    "Package RACI parity",
    "canonical parent graph",
    "derived Package and Milestone columns",
    "approval and trash invariants",
    "canonical preference values",
    "legacy preference filter keys",
    "legacy create replay snapshots",
    "legacy update replay snapshots",
    "special Epic delete replay storage",
  ]) {
    assert.match(script, new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("cutover runbook requires restore proof and object-by-object RESTRICT drops", async () => {
  assert.match(runbook, /full custom-format database dump/);
  assert.match(runbook, /founderops_cutover_restore_test/);
  assert.match(runbook, /source\/restored counts match/);
  assert.match(runbook, /Object-by-object `RESTRICT` manifest/);
  assert.match(runbook, /drop view public\.active_packages restrict/);
  assert.match(runbook, /Historical URL redirects and delete receipts are preserved under canonical names/);
  assert.match(script, /source snapshots preserved/);
  assert.match(runbook, /immutable legacy source snapshots/i);
  const migration = await readFile("supabase/migrations/20260813125245_planning_legacy_big_bang_cutover.sql", "utf8");
  assert.match(migration, /planning_cutover_source_columns/);
  assert.match(migration, /source snapshot fidelity failed/);
  assert.match(migration, /jsonb_object_keys\(link\.source_snapshot\)/);
  assert.match(runbook, /drop column package_id restrict/);
  assert.match(runbook, /drop column milestone_id restrict/);
  assert.match(runbook, /drop table public\.packages restrict/);
  assert.match(runbook, /drop table public\.milestones restrict/);
  assert.match(runbook, /in-transaction parity, row-count, and checksum gates/);
  assert.doesNotMatch(runbook, /drop[^;\n]*cascade|truncate table|delete from/i);
});
