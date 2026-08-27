import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import pg from "pg";

const execFileAsync = promisify(execFile);
const supabaseCli = resolve(process.cwd(), "node_modules", ".bin", "supabase");

async function localDatabaseUrl() {
  const { stdout } = await execFileAsync(supabaseCli, ["status", "-o", "json"], { encoding: "utf8" });
  const status = JSON.parse(stdout) as { DB_URL?: unknown };
  if (typeof status.DB_URL !== "string" || !status.DB_URL.startsWith("postgresql://")) {
    throw new Error("Local Supabase did not expose a database URL.");
  }
  return status.DB_URL;
}

export async function withIsolatedLocalDatabase(
  callback: (client: pg.Client) => Promise<void>,
) {
  const client = new pg.Client(await localDatabaseUrl());
  await client.connect();
  await client.query("begin");
  try {
    await callback(client);
  } finally {
    await client.query("reset role").catch(() => undefined);
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

export async function asAuthenticated<T>(
  client: pg.Client,
  authUserId: string,
  callback: () => Promise<T>,
) {
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [authUserId]);
  await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  await client.query("set local role authenticated");
  const result = await callback();
  await client.query("reset role");
  return result;
}

export async function captureDatabaseError(
  client: pg.Client,
  operation: () => Promise<unknown>,
) {
  await client.query("savepoint expected_database_error");
  let captured: unknown;
  try {
    await operation();
  } catch (error) {
    captured = error;
  }
  await client.query("rollback to savepoint expected_database_error");
  await client.query("release savepoint expected_database_error");
  if (!captured) throw new Error("Expected database operation to fail.");
  return captured;
}
