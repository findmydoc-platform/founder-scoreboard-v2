import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

/** Validate the current project's CLI result before a fixture connects. */
export function validateLocalSupabaseTarget(status, configuration, expectedDatabase) {
  const deny = () => { throw new Error("Expected the configured local Supabase target."); };
  const sections = new Map();
  let section = "";
  for (const raw of configuration.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    const heading = /^\[([^\]]+)\]$/.exec(line);
    if (heading) { section = heading[1]; continue; }
    const field = /^(project_id|port)\s*=\s*(.+)$/.exec(line);
    if (field) sections.set(`${section}.${field[1]}`, field[2]);
  }
  if (!/^"[^"\r\n]+"$/.test(sections.get(".project_id") || "")) deny();
  const apiPort = sections.get("api.port"), databasePort = sections.get("db.port");
  if (![apiPort, databasePort].every(port => /^\d+$/.test(port || "") && Number(port) > 0 && Number(port) <= 65535)) deny();
  let api, database;
  try { api = new URL(status.API_URL); database = new URL(status.DB_URL); } catch { deny(); }
  const loopback = host => ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (!loopback(api.hostname) || !loopback(database.hostname)
    || !["http:", "https:"].includes(api.protocol) || !["postgres:", "postgresql:"].includes(database.protocol)
    || api.port !== apiPort || database.port !== databasePort) deny();
  if (expectedDatabase !== undefined && (!expectedDatabase || expectedDatabase !== status.DB_URL)) deny();
  return status;
}

/** CLI status is scoped to cwd, whose configured project and ports remain authoritative. */
export async function localSupabaseStatus() {
  const configuration = await readFile(resolve("supabase/config.toml"), "utf8");
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]);
  return validateLocalSupabaseTarget(JSON.parse(stdout), configuration, process.env.DISPOSABLE_DB_URL);
}
