import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { loadLocalEnv } from "./lib/env.mjs";
import { resolveProductionSchemaConnection } from "./lib/production-schema-connection.mjs";

const migrationFiles = [
  "supabase/0057_rename_github_issue_sync_fields.sql",
  "supabase/0058_task_comment_github_delivery_outbox.sql",
];

await loadLocalEnv();

if (process.env.SCHEMA_DEPLOY_TARGET !== "production") {
  throw new Error("Refusing GitHub sync migration deploy: SCHEMA_DEPLOY_TARGET must be production.");
}
if (process.env.GITHUB_REF && process.env.GITHUB_REF !== "refs/heads/main") {
  throw new Error(`Refusing production migrations from ${process.env.GITHUB_REF}.`);
}

const client = new pg.Client(resolveProductionSchemaConnection(process.env));
await client.connect();

try {
  const columns = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tasks'
      and column_name = 'github_issue_sync_status'
  `);
  const columnNames = new Set(columns.rows.map((row) => row.column_name));
  const schemaRenamed = !columnNames.has("github_issue_sync_status");

  if (schemaRenamed) {
    const activeLocks = await client.query(`
      select count(*)::integer as count
      from public.github_issue_sync_locks
      where expires_at > now()
    `);
    if (Number(activeLocks.rows[0]?.count || 0) > 0) {
      throw new Error("Refusing GitHub sync migration deploy: an active GitHub issue sync lock exists.");
    }
  }

  for (const [index, file] of migrationFiles.entries()) {
    const sql = await readFile(resolve(process.cwd(), file), "utf8");
    await client.query(sql);
    if (index === 0 && process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `schema_renamed=${schemaRenamed}\n`, "utf8");
    }
    console.log(`Applied production migration ${file}.`);
  }

  await client.query("notify pgrst, 'reload schema'");
} finally {
  await client.end();
}
