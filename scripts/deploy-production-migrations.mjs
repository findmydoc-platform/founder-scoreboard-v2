import { spawn } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
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
if (process.env.GITHUB_REF && process.env.GITHUB_REF !== "refs/heads/main") {
  throw new Error(`Refusing production migrations from ${process.env.GITHUB_REF}.`);
}

const migrations = await listSupabaseMigrations();
if (migrations[0]?.file !== productionBaseline.file) {
  throw new Error(`${productionBaseline.file} must remain the first migration in the ordered history.`);
}
for (const migration of migrations) {
  const destructiveDdl = findUnapprovedDestructiveDdl(migration);
  if (destructiveDdl.length) {
    throw new Error(`${migration.file} contains destructive DDL (${destructiveDdl.join(", ")}); use the explicitly approved destructive path.`);
  }
}

const connection = resolveProductionSchemaConnection(process.env);
const client = new pg.Client(connection);
await client.connect();

try {
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
} finally {
  await client.end();
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
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(supabaseCli, args, { stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`Supabase CLI failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`));
    });
  });
}

await runSupabase(["db", "push", "--db-url", databaseUrl.toString(), "--dry-run", "--yes"]);
await runSupabase(["db", "push", "--db-url", databaseUrl.toString(), "--yes"]);

const reloadClient = new pg.Client(connection);
await reloadClient.connect();
try {
  await reloadClient.query("notify pgrst, 'reload schema'");
} finally {
  await reloadClient.end();
}

console.log("Applied pending Supabase migrations and requested a PostgREST schema reload.");
