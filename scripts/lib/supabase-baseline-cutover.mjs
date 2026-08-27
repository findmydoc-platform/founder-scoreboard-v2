import { createHash } from "node:crypto";

const APPLICATION_SCHEMAS = ["auth", "public", "storage"];

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashLedgerVersions(versions) {
  return sha256(`${[...versions].sort().join("\n")}\n`);
}

export function hashApplicationSnapshot(snapshot) {
  return sha256(JSON.stringify(snapshot));
}

export function normalizeSchemaDump(sql) {
  return sql
    .replace(/^\s*\\(?:un)?restrict\s+.*$/gm, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildLedgerCutoverPlan({
  baselineVersion,
  expectedLedgerSha256,
  expectedSupersededCount,
  remoteVersions,
}) {
  const versions = [...remoteVersions].map(String).sort();
  if (!/^\d{14}$/.test(baselineVersion)) {
    throw new Error("The baseline version must be a 14-digit timestamp.");
  }
  if (!/^[a-f0-9]{64}$/.test(expectedLedgerSha256)) {
    throw new Error("The expected ledger SHA-256 is invalid.");
  }
  if (!Number.isSafeInteger(expectedSupersededCount) || expectedSupersededCount < 1) {
    throw new Error("The expected superseded migration count must be a positive integer.");
  }
  if (versions.includes(baselineVersion)) {
    throw new Error(`Baseline ${baselineVersion} is already present in the production ledger.`);
  }
  const unexpected = versions.filter((version) => !/^\d{14}$/.test(version) || version >= baselineVersion);
  if (unexpected.length) {
    throw new Error(`Production ledger contains unexpected versions: ${unexpected.join(", ")}.`);
  }
  if (versions.length !== expectedSupersededCount) {
    throw new Error(
      `Expected ${expectedSupersededCount} superseded migrations, found ${versions.length}.`,
    );
  }
  const ledgerSha256 = hashLedgerVersions(versions);
  if (ledgerSha256 !== expectedLedgerSha256) {
    throw new Error("Production migration ledger does not match the restore-tested backup.");
  }
  return { ledgerSha256, supersededVersions: versions };
}

export async function buildDatabaseSnapshot(client) {
  const tablesResult = await client.query(
    `
      select table_schema, table_name
      from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema = any($1::text[])
      order by table_schema, table_name
    `,
    [APPLICATION_SCHEMAS],
  );

  const tables = [];
  for (const { table_schema: schema, table_name: table } of tablesResult.rows) {
    const relation = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
    const result = await client.query(`
      select
        count(*)::text as row_count,
        md5(coalesce(string_agg(row_hash, '' order by row_hash), '')) as checksum
      from (
        select md5(to_jsonb(source_row)::text) as row_hash
        from ${relation} as source_row
      ) as row_hashes
    `);
    tables.push({
      checksum: result.rows[0].checksum,
      rowCount: result.rows[0].row_count,
      schema,
      table,
    });
  }

  const sequencesResult = await client.query(
    `
      select sequence_schema, sequence_name
      from information_schema.sequences
      where sequence_schema = any($1::text[])
      order by sequence_schema, sequence_name
    `,
    [APPLICATION_SCHEMAS],
  );

  const sequences = [];
  for (const { sequence_schema: schema, sequence_name: sequence } of sequencesResult.rows) {
    const relation = `${quoteIdentifier(schema)}.${quoteIdentifier(sequence)}`;
    const result = await client.query(`select last_value::text, is_called from ${relation}`);
    sequences.push({
      isCalled: result.rows[0].is_called,
      lastValue: result.rows[0].last_value,
      schema,
      sequence,
    });
  }

  const ledgerResult = await client.query(
    "select version from supabase_migrations.schema_migrations order by version",
  );
  const ledgerVersions = ledgerResult.rows.map(({ version }) => String(version));
  const application = { sequences, tables };

  return {
    application,
    applicationSha256: hashApplicationSnapshot(application),
    ledgerSha256: hashLedgerVersions(ledgerVersions),
    ledgerVersions,
  };
}
