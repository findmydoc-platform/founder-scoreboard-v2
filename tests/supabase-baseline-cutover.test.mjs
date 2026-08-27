import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLedgerCutoverPlan,
  hashLedgerVersions,
  normalizeSchemaDump,
} from "../scripts/lib/supabase-baseline-cutover.mjs";

test("ledger cutover requires the exact restore-tested production history", () => {
  const versions = ["20260101000000", "20260202000000"];
  const plan = buildLedgerCutoverPlan({
    baselineVersion: "20260827064853",
    expectedLedgerSha256: hashLedgerVersions(versions),
    expectedSupersededCount: 2,
    remoteVersions: versions,
  });

  assert.deepEqual(plan.supersededVersions, versions);
});

test("ledger cutover rejects a changed, post-baseline, or already repaired history", () => {
  const expectedLedgerSha256 = hashLedgerVersions(["20260101000000"]);
  const base = {
    baselineVersion: "20260827064853",
    expectedLedgerSha256,
    expectedSupersededCount: 1,
  };

  assert.throws(
    () => buildLedgerCutoverPlan({ ...base, remoteVersions: ["20260102000000"] }),
    /does not match the restore-tested backup/,
  );
  assert.throws(
    () => buildLedgerCutoverPlan({ ...base, remoteVersions: ["20260827083034"] }),
    /unexpected versions/,
  );
  assert.throws(
    () => buildLedgerCutoverPlan({ ...base, remoteVersions: ["20260827064853"] }),
    /already present/,
  );
});

test("schema normalization removes dump-session noise but preserves statements", () => {
  const first = `
    -- PostgreSQL database dump
    \\restrict random-token-a
    CREATE TABLE public.example (id bigint);
    \\unrestrict random-token-a
  `;
  const second = `
    -- different comment
    \\restrict random-token-b
    CREATE   TABLE public.example (id bigint);
    \\unrestrict random-token-b
  `;

  assert.equal(normalizeSchemaDump(first), normalizeSchemaDump(second));
});
