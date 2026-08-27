import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLedgerCutoverPlan,
  hashLedgerVersions,
  lockApplicationTables,
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
  assert.equal(plan.baselineApplied, false);
});

test("ledger cutover resumes after baseline insertion and accepts a completed repair", () => {
  const versions = ["20260101000000", "20260202000000"];
  const base = {
    baselineVersion: "20260827064853",
    expectedLedgerSha256: hashLedgerVersions(versions),
    expectedSupersededCount: 2,
  };
  const resumable = buildLedgerCutoverPlan({
    ...base,
    remoteVersions: [...versions, base.baselineVersion],
  });
  const complete = buildLedgerCutoverPlan({
    ...base,
    remoteVersions: [base.baselineVersion],
  });

  assert.equal(resumable.baselineApplied, true);
  assert.deepEqual(resumable.supersededVersions, versions);
  assert.deepEqual(complete, { baselineApplied: true, supersededVersions: [] });
});

test("ledger cutover rejects a changed, partial, or post-baseline history", () => {
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
    () => buildLedgerCutoverPlan({ ...base, remoteVersions: ["20260101000000", "20260827070000"] }),
    /unexpected versions/,
  );
  assert.throws(
    () => buildLedgerCutoverPlan({ ...base, remoteVersions: ["20260827064853", "20260102000000"] }),
    /does not match the restore-tested backup/,
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

test("application lock quotes every discovered table and fails closed without tables", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ params, sql });
      if (calls.length === 1) {
        return {
          rows: [
            { table_name: "users", table_schema: "auth" },
            { table_name: "workweek_windows", table_schema: "public" },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const relations = await lockApplicationTables(client, ["auth", "public"]);

  assert.deepEqual(relations, ['"auth"."users"', '"public"."workweek_windows"']);
  assert.deepEqual(calls[0].params, [["auth", "public"]]);
  assert.match(calls[1].sql, /^lock table "auth"\."users", "public"\."workweek_windows" in share mode$/);
  await assert.rejects(
    () => lockApplicationTables({ query: async () => ({ rows: [] }) }, []),
    /require at least one schema/,
  );
  await assert.rejects(
    () => lockApplicationTables({ query: async () => ({ rows: [] }) }, ["public"]),
    /No application tables were found/,
  );
});
