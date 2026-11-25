import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import {
  applyApprovedMigrations,
  parseApprovedMigrationPlan,
  verifyInOrderPendingMigrations,
  verifyApprovedMigrationDryRun,
  verifyProductionMigrationSource,
} from "./lib/deploy-production-migration-plan.mjs";
import { loadLocalEnv } from "./lib/env.mjs";
import { resolveProductionSchemaConnection } from "./lib/production-schema-connection.mjs";
import {
  findUnapprovedDestructiveDdl,
  listSupabaseMigrations,
  productionBaseline,
} from "./lib/supabase-migrations.mjs";

await loadLocalEnv();

if (process.env.SCHEMA_DEPLOY_TARGET !== "production") {
  throw new Error("Refusing migration deploy: SCHEMA_DEPLOY_TARGET must be production.");
}
const approval = process.env.APPROVED_PRODUCTION_MIGRATION_PLAN;
if (!process.env.GITHUB_EVENT_PATH) {
  throw new Error("Production migrations require the GitHub workflow event file.");
}
const plan = approval ? parseApprovedMigrationPlan(approval) : null;
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
await verifyProductionMigrationSource({ plan, root: process.cwd(), env: process.env, event });

const migrations = await listSupabaseMigrations();
if (migrations[0]?.file !== productionBaseline.file) {
  throw new Error(`${productionBaseline.file} must remain the first migration in the ordered history.`);
}
if (migrations[0].sha256 !== productionBaseline.sha256) {
  throw new Error("Production baseline checksum differs from the pinned value.");
}
for (const migration of migrations) {
  const destructiveDdl = findUnapprovedDestructiveDdl(migration);
  if (destructiveDdl.length) {
    throw new Error(`${migration.file} contains destructive DDL (${destructiveDdl.join(", ")}); use the explicitly approved destructive path.`);
  }
}

const connection = resolveProductionSchemaConnection(process.env);
async function checkLedgerAndLocks(client) {
  const ledger = await client.query("select to_regclass('supabase_migrations.schema_migrations')::text as relation");
  if (!ledger.rows[0]?.relation) {
    throw new Error(`Production migration ledger is not initialized. Restore-test the backup, then mark ${productionBaseline.version} as applied before merging.`);
  }

  const baseline = await client.query(
    "select version from supabase_migrations.schema_migrations where version = $1",
    [productionBaseline.version],
  );
  if (baseline.rowCount !== 1) {
    throw new Error(`Production baseline ${productionBaseline.version} is not marked as applied; refusing to replay it.`);
  }

  const lockTable = await client.query("select to_regclass('public.github_issue_sync_locks')::text as relation");
  if (lockTable.rows[0]?.relation) {
    const activeLocks = await client.query(`
      select count(*)::integer as count
      from public.github_issue_sync_locks
      where expires_at > now()
    `);
    if (Number(activeLocks.rows[0]?.count || 0) > 0) {
      throw new Error("Refusing migration deploy: an active GitHub issue sync lock exists.");
    }
  }
  const versions = await client.query("select version from supabase_migrations.schema_migrations order by version");
  return versions.rows.map(({ version }) => version);
}

const databaseUrl = new URL("postgresql://localhost/postgres");
databaseUrl.hostname = connection.host;
databaseUrl.port = String(connection.port);
databaseUrl.username = connection.user;
databaseUrl.password = connection.password;
databaseUrl.pathname = `/${connection.database}`;
databaseUrl.searchParams.set("sslmode", "require");

const supabaseCli = resolve(process.cwd(), "node_modules", ".bin", "supabase");

async function runSupabase(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(supabaseCli, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let outputLimitExceeded = false;
    const append = (chunk) => {
      if (outputLimitExceeded) return;
      output += chunk;
      if (output.length > 1024 * 1024) {
        outputLimitExceeded = true;
        child.kill();
      }
    };
    child.stdout?.setEncoding("utf8").on("data", append);
    child.stderr?.setEncoding("utf8").on("data", append);
    child.once("error", () => rejectRun(new Error("Could not start the Supabase CLI for the migration deploy.")));
    child.once("close", (code, signal) => {
      if (outputLimitExceeded) rejectRun(new Error("Supabase CLI exceeded the migration output limit."));
      else if (code === 0) resolveRun(output);
      else rejectRun(new Error(`Supabase CLI failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`));
    });
  });
}

const client = new pg.Client(connection);
await client.connect();
try {
  const lock = await client.query(
    "select pg_try_advisory_lock(hashtextextended('founderops.production.schema.deploy', 0)) as acquired",
  );
  if (lock.rows[0]?.acquired !== true) {
    throw new Error("Refusing migration deploy: another schema deployment holds the session lock.");
  }
  const push = ["db", "push", "--db-url", databaseUrl.toString()];
  if (plan) {
    await applyApprovedMigrations({
      plan,
      migrations,
      checkLedgerAndLocks: () => checkLedgerAndLocks(client),
      runCli: (flags) => runSupabase([...push, ...flags]),
    });
    await client.query("notify pgrst, 'reload schema'");
    console.log("Applied the approved Supabase migrations and requested a PostgREST schema reload.");
  } else {
    const initialLedger = await checkLedgerAndLocks(client);
    const pending = verifyInOrderPendingMigrations(migrations, initialLedger);
    if (pending.length) {
      const dry = await runSupabase([...push, "--dry-run", "--yes"]);
      verifyApprovedMigrationDryRun(dry, pending);
      const currentLedger = await checkLedgerAndLocks(client);
      if (JSON.stringify(initialLedger) !== JSON.stringify(currentLedger)) {
        throw new Error("Refusing migration deploy: the live ledger changed after the dry run.");
      }
      await runSupabase([...push, "--yes"]);
      const remaining = verifyInOrderPendingMigrations(migrations, await checkLedgerAndLocks(client));
      if (remaining.length) throw new Error("The final Supabase ledger is missing expected migrations.");
      await client.query("notify pgrst, 'reload schema'");
      console.log("Applied the in-order Supabase migrations and requested a PostgREST schema reload.");
    } else {
      console.log("Supabase migration ledger already matches checkout. No migration was needed.");
    }
  }
} finally {
  await client.end();
}
