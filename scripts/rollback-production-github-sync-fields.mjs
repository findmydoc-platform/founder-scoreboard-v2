import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { loadLocalEnv } from "./lib/env.mjs";
import { resolveProductionSchemaConnection } from "./lib/production-schema-connection.mjs";

await loadLocalEnv();

if (process.env.SCHEMA_DEPLOY_TARGET !== "production") {
  throw new Error("Refusing GitHub sync rollback: SCHEMA_DEPLOY_TARGET must be production.");
}
if (process.env.GITHUB_REF && process.env.GITHUB_REF !== "refs/heads/main") {
  throw new Error(`Refusing production rollback from ${process.env.GITHUB_REF}.`);
}

const sql = await readFile(resolve(process.cwd(), "supabase/rollback/0057_restore_github_sync_fields.sql"), "utf8");
const client = new pg.Client(resolveProductionSchemaConnection(process.env));
await client.connect();
try {
  await client.query(sql);
  await client.query("notify pgrst, 'reload schema'");
} finally {
  await client.end();
}

console.log("Restored the previous GitHub issue sync field names after a failed production cutover.");
