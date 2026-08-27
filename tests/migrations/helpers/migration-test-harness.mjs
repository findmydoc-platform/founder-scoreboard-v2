import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const supabaseCli = resolve(process.cwd(), "node_modules", ".bin", "supabase");

function runSupabase(args, { capture = false } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(supabaseCli, args, {
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";

    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }

    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun(stdout);
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      rejectRun(new Error(`Supabase CLI failed with ${reason}.${capture && stderr ? ` ${stderr.trim()}` : ""}`));
    });
  });
}

export async function resetLocalDatabaseTo(version) {
  assert.match(version, /^\d{14}$/u);
  await runSupabase(["db", "reset", "--local", "--version", version, "--no-seed"]);
}

async function localDatabaseUrl() {
  const status = JSON.parse(await runSupabase(["status", "-o", "json"], { capture: true }));
  if (typeof status.DB_URL !== "string" || !status.DB_URL.startsWith("postgresql://")) {
    throw new Error("Local Supabase did not expose a database URL.");
  }
  return status.DB_URL;
}

export async function withLocalDatabase(callback) {
  const client = new pg.Client(await localDatabaseUrl());
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

export async function applyMigration(client, migrationFile) {
  const sql = await readFile(migrationFile, "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function snapshotRows(client, { table, columns, orderBy }) {
  const identifiers = [table, ...columns, ...orderBy];
  for (const identifier of identifiers) {
    assert.match(identifier, /^[a-z_][a-z0-9_]*$/u);
  }
  const selected = columns.map((column) => `"${column}"`).join(", ");
  const ordering = orderBy.map((column) => `"${column}"`).join(", ");
  const result = await client.query(
    `select ${selected} from "public"."${table}" order by ${ordering}`,
  );
  return {
    count: result.rowCount,
    rows: result.rows,
  };
}

export function assertRowsPreserved(before, after) {
  assert.deepEqual(after, before);
}
