import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { loadLocalEnv } from "./lib/env.mjs";
import { resolveProductionSchemaConnection } from "./lib/production-schema-connection.mjs";

const schemaFile = "supabase/schema.sql";
const approvedDestructiveMigrationFiles = [
  "20260712213443_remove_legacy_team_task_intake_v12.sql",
];
const target = process.env.SCHEMA_DEPLOY_TARGET;
const githubRef = process.env.GITHUB_REF;

await loadLocalEnv();

if (target !== "production") {
  console.error("Refusing schema deploy: SCHEMA_DEPLOY_TARGET must be production.");
  process.exit(1);
}

if (githubRef && githubRef !== "refs/heads/main") {
  console.error(`Refusing production schema deploy from ${githubRef}.`);
  process.exit(1);
}

let connection;
try {
  connection = resolveProductionSchemaConnection(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid production database connection configuration.");
  process.exit(1);
}

const schemaSql = await readFile(resolve(process.cwd(), schemaFile), "utf8");
const approvedDestructiveMigrations = await Promise.all(
  approvedDestructiveMigrationFiles.map(async (file) => ({
    file,
    sql: await readFile(resolve(process.cwd(), "supabase", "migrations", file), "utf8"),
  })),
);
const blockedPatterns = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+schema\b/i,
  /\btruncate\b/i,
  /\balter\s+table\b[\s\S]*?\bdrop\s+column\b/i,
];

if (blockedPatterns.some((pattern) => pattern.test(schemaSql))) {
  console.error(`${schemaFile} contains destructive DDL; deploy it through a reviewed manual path.`);
  process.exit(1);
}

const client = new pg.Client(connection);

await client.connect();

try {
  await client.query("begin");
  await client.query(schemaSql);
  for (const migration of approvedDestructiveMigrations) {
    await client.query(migration.sql);
  }
  await client.query("notify pgrst, 'reload schema'");
  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}

console.log(`Applied production schema from ${schemaFile} and ${approvedDestructiveMigrations.length} approved cleanup migration(s).`);
