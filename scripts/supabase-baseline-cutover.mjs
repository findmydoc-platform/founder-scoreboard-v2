import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { resolveProductionSchemaConnection } from "./lib/production-schema-connection.mjs";
import {
  buildDatabaseSnapshot,
  buildLedgerCutoverPlan,
  lockApplicationTables,
  readLedgerVersions,
} from "./lib/supabase-baseline-cutover.mjs";
import {
  listSupabaseMigrations,
  productionBaseline,
} from "./lib/supabase-migrations.mjs";

const action = process.argv[2];

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function resolveConnection() {
  if (process.env.SCHEMA_DEPLOY_TARGET === "production") {
    return resolveProductionSchemaConnection(process.env);
  }
  if (process.env.SCHEMA_DEPLOY_TARGET !== "restore-test") {
    throw new Error("SCHEMA_DEPLOY_TARGET must be production or restore-test.");
  }
  return {
    database: requiredEnv("PGDATABASE"),
    host: requiredEnv("PGHOST"),
    password: requiredEnv("PGPASSWORD"),
    port: Number(requiredEnv("PGPORT")),
    ssl: false,
    user: requiredEnv("PGUSER"),
  };
}

async function withClient(callback) {
  const client = new pg.Client(resolveConnection());
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function writeSnapshot(file) {
  const snapshot = await withClient(buildDatabaseSnapshot);
  await writeFile(resolve(file), `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  console.log(`Database snapshot written to ${resolve(file)}.`);
  return snapshot;
}

async function runSupabase(args) {
  const executable = resolve(process.cwd(), "node_modules", ".bin", "supabase");
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun({ stderr, stdout });
      else rejectRun(new Error(`Supabase CLI failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`));
    });
  });
}

async function repairLedger() {
  if (process.env.SCHEMA_DEPLOY_TARGET !== "production") {
    throw new Error("Ledger repair is restricted to SCHEMA_DEPLOY_TARGET=production.");
  }
  if (process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Ledger repair is restricted to refs/heads/main.");
  }
  const confirmation = requiredEnv("BASELINE_CUTOVER_CONFIRMATION");
  if (confirmation !== `repair-${productionBaseline.version}`) {
    throw new Error(`BASELINE_CUTOVER_CONFIRMATION must equal repair-${productionBaseline.version}.`);
  }

  const restoreApplicationSha256 = requiredEnv("EXPECTED_APPLICATION_SHA256");
  const expectedLedgerSha256 = requiredEnv("EXPECTED_LEDGER_SHA256");
  const expectedSupersededCount = Number(requiredEnv("EXPECTED_SUPERSEDED_COUNT"));
  const expectedPendingVersions = requiredEnv("EXPECTED_PENDING_VERSIONS")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  const restoreManifestSha256 = requiredEnv("RESTORE_MANIFEST_SHA256");
  if (!/^[a-f0-9]{64}$/.test(restoreManifestSha256)) {
    throw new Error("RESTORE_MANIFEST_SHA256 is invalid.");
  }

  const migrations = await listSupabaseMigrations();
  if (migrations[0]?.file !== productionBaseline.file) {
    throw new Error(`${productionBaseline.file} must remain the first local migration.`);
  }
  const localPendingVersions = migrations.slice(1).map(({ version }) => version).sort();
  if (JSON.stringify(localPendingVersions) !== JSON.stringify(expectedPendingVersions)) {
    throw new Error(
      `Expected pending migrations ${expectedPendingVersions.join(", ")}, found ${localPendingVersions.join(", ")}.`,
    );
  }

  const databaseUrl = "postgresql:///postgres?service=founderops-production";
  const initialPlan = await withClient(async (client) => buildLedgerCutoverPlan({
    baselineVersion: productionBaseline.version,
    expectedLedgerSha256,
    expectedSupersededCount,
    remoteVersions: await readLedgerVersions(client),
  }));
  if (!initialPlan.baselineApplied) {
    await runSupabase([
      "migration",
      "repair",
      "--db-url",
      databaseUrl,
      "--status",
      "applied",
      productionBaseline.version,
    ]);
  }

  const client = new pg.Client(resolveConnection());
  await client.connect();
  let before;
  let after;
  try {
    await client.query("begin");
    const protectedSchemas = ["public"];
    await lockApplicationTables(client, protectedSchemas);
    before = await buildDatabaseSnapshot(client, { schemas: protectedSchemas });
    const plan = buildLedgerCutoverPlan({
      baselineVersion: productionBaseline.version,
      expectedLedgerSha256,
      expectedSupersededCount,
      remoteVersions: before.ledgerVersions,
    });
    if (!plan.baselineApplied) {
      throw new Error("The baseline marker was not visible inside the guarded cutover transaction.");
    }
    if (plan.supersededVersions.length) {
      const reverted = await client.query(
        `
          delete from supabase_migrations.schema_migrations
          where version = any($1::text[])
          returning version
        `,
        [plan.supersededVersions],
      );
      const revertedVersions = reverted.rows.map(({ version }) => String(version)).sort();
      if (JSON.stringify(revertedVersions) !== JSON.stringify(plan.supersededVersions)) {
        throw new Error("The exact superseded migration set was not reverted.");
      }
    }

    after = await buildDatabaseSnapshot(client, { schemas: protectedSchemas });
    if (after.applicationSha256 !== before.applicationSha256) {
      throw new Error("Application data changed during the ledger repair.");
    }
    if (JSON.stringify(after.ledgerVersions) !== JSON.stringify([productionBaseline.version])) {
      throw new Error("Production migration ledger does not contain exactly the baseline after repair.");
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }

  const dryRun = await runSupabase([
    "db",
    "push",
    "--db-url",
    databaseUrl,
    "--dry-run",
    "--yes",
  ]);
  const dryRunText = `${dryRun.stdout}\n${dryRun.stderr}`;
  for (const version of expectedPendingVersions) {
    if (!dryRunText.includes(version)) {
      throw new Error(`Dry run did not report pending migration ${version}.`);
    }
  }
  const unexpectedVersions = [...dryRunText.matchAll(/\b(\d{14})_[a-z0-9_]+\.sql\b/g)]
    .map((match) => match[1])
    .filter((version) => !expectedPendingVersions.includes(version));
  if (unexpectedVersions.length) {
    throw new Error(`Dry run reported unexpected migrations: ${unexpectedVersions.join(", ")}.`);
  }

  const outputDirectory = resolve(requiredEnv("CUTOVER_OUTPUT_DIR"));
  await writeFile(resolve(outputDirectory, "before-repair.json"), `${JSON.stringify(before, null, 2)}\n`, { mode: 0o600 });
  await writeFile(resolve(outputDirectory, "after-repair.json"), `${JSON.stringify(after, null, 2)}\n`, { mode: 0o600 });
  await writeFile(resolve(outputDirectory, "restore-manifest.sha256"), `${restoreManifestSha256}\n`, { mode: 0o600 });
  await writeFile(resolve(outputDirectory, "restore-application.sha256"), `${restoreApplicationSha256}\n`, { mode: 0o600 });
  console.log(`Repaired the production ledger to baseline ${productionBaseline.version}; dry run is limited to ${expectedPendingVersions.join(", ")}.`);
}

if (action === "snapshot") {
  await writeSnapshot(requiredEnv("CUTOVER_SNAPSHOT_FILE"));
} else if (action === "repair") {
  await repairLedger();
} else if (action === "snapshot-hash") {
  const snapshot = JSON.parse(await readFile(resolve(requiredEnv("CUTOVER_SNAPSHOT_FILE")), "utf8"));
  console.log(snapshot.applicationSha256);
} else {
  throw new Error("Usage: node scripts/supabase-baseline-cutover.mjs <snapshot|repair|snapshot-hash>");
}
