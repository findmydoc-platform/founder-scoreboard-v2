import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { loadLocalEnv } from "./lib/env.mjs";

const schemaFile = "supabase/schema.sql";
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

const password = process.env.SUPABASE_DB_PASSWORD;
const host = process.env.SUPABASE_DB_HOST || deriveSupabaseDbHost(process.env.NEXT_PUBLIC_SUPABASE_URL) || "db.wmccchyodlljkkytebwg.supabase.co";
const user = process.env.SUPABASE_DB_USER || "postgres";
const database = process.env.SUPABASE_DB_NAME || "postgres";

if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD.");
  process.exit(1);
}

const sql = await readFile(resolve(process.cwd(), schemaFile), "utf8");
const blockedPatterns = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+schema\b/i,
  /\btruncate\b/i,
  /\balter\s+table\b[\s\S]*?\bdrop\s+column\b/i,
];

if (blockedPatterns.some((pattern) => pattern.test(sql))) {
  console.error(`${schemaFile} contains destructive DDL; deploy it through a reviewed manual path.`);
  process.exit(1);
}

const client = new pg.Client({
  host,
  port: 5432,
  user,
  password,
  database,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  await client.query("begin");
  await client.query(sql);
  await client.query("notify pgrst, 'reload schema'");
  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}

console.log(`Applied production schema from ${schemaFile}.`);

function deriveSupabaseDbHost(url) {
  if (!url) return "";

  try {
    const hostname = new URL(url).hostname;
    if (!hostname.endsWith(".supabase.co")) return "";

    const [projectRef] = hostname.split(".");
    if (!projectRef || projectRef === "db") return "";

    return `db.${projectRef}.supabase.co`;
  } catch {
    return "";
  }
}
