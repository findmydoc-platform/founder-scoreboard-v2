import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { loadLocalEnv } from "./lib/env.mjs";

const [, , sqlFile] = process.argv;
await loadLocalEnv();

if (!sqlFile) {
  console.error("Usage: node scripts/apply-sql.mjs <sql-file>");
  process.exit(1);
}

const password = process.env.SUPABASE_DB_PASSWORD;
const host = process.env.SUPABASE_DB_HOST || "db.wmccchyodlljkkytebwg.supabase.co";
const user = process.env.SUPABASE_DB_USER || "postgres";
const database = process.env.SUPABASE_DB_NAME || "postgres";

if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD.");
  process.exit(1);
}

const sql = await readFile(resolve(process.cwd(), sqlFile), "utf8");
const client = new pg.Client({
  host,
  port: 5432,
  user,
  password,
  database,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
await client.query(sql);
await client.end();

console.log(`Applied ${sqlFile}`);
