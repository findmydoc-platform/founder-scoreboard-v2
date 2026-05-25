import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const [, , sqlFile] = process.argv;
const envPath = resolve(process.cwd(), ".env.local");

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const separator = trimmed.indexOf("=");
  if (separator < 0) return null;

  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  return [key, value];
}

if (existsSync(envPath)) {
  const envFile = await readFile(envPath, "utf8");
  for (const pair of envFile.split(/\r?\n/).map(parseEnvLine)) {
    if (!pair) continue;
    const [key, value] = pair;
    process.env[key] ||= value;
  }
}

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
