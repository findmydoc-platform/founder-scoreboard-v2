import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const productionBaseline = {
  file: "20260827064853_current_schema_baseline.sql",
  version: "20260827064853",
  sha256: "5a1d4c9aedf2db45385002451f4234271df63b243b6c0eb546861ad95333d85d",
};

export const approvedDestructiveDdlByMigration = new Map();

export const migrationFilePattern = /^(\d{14})_([a-z0-9_]+)\.sql$/;

export async function listSupabaseMigrations(root = process.cwd()) {
  const directory = resolve(root, "supabase", "migrations");
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(files.map(async (file) => {
    const match = file.match(migrationFilePattern);
    const sql = await readFile(resolve(directory, file), "utf8");
    return {
      file,
      version: match?.[1] || "",
      name: match?.[2] || "",
      sql,
      sha256: createHash("sha256").update(sql).digest("hex"),
    };
  }));
}

export function findDestructiveDdl(sql) {
  const patterns = [
    ["drop table", /^\s*drop\s+table\b/im],
    ["drop schema", /^\s*drop\s+schema\b/im],
    ["truncate", /^\s*truncate\s+(?:table\s+)?/im],
    ["drop column", /^\s*alter\s+table\b[^;]*\bdrop\s+column\b/im],
  ];

  return patterns.filter(([, pattern]) => pattern.test(sql)).map(([label]) => label);
}

export function findUnapprovedDestructiveDdl(migration) {
  const approvedOperations = approvedDestructiveDdlByMigration.get(migration.file) || new Set();
  return findDestructiveDdl(migration.sql)
    .filter((operation) => !approvedOperations.has(operation));
}
