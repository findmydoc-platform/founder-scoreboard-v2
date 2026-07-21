import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const productionBaseline = {
  file: "20260713120959_production_baseline.sql",
  version: "20260713120959",
  sha256: "63421ddef79d60d0a5e117915285297ab48f318348278c42ca748d46183be2a5",
};

export const approvedDestructiveDdlByMigration = new Map([
  ["20260721120056_replace_task_activity_with_audit_log.sql", new Set(["drop table"])],
]);

export const approvedOutOfOrderMigrationVersions = new Set([
  "20260721112813",
  "20260721120056",
]);

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

export async function readSupabaseMigrationCorpus(root = process.cwd()) {
  const migrations = await listSupabaseMigrations(root);
  return migrations
    .map(({ file, sql }) => `\n-- Migration: ${file}\n${sql}`)
    .join("\n");
}

export async function readSupabaseSchemaContract(root = process.cwd()) {
  const corpus = await readSupabaseMigrationCorpus(root);
  const dequoted = corpus
    .replace(/"([^"]+)"/g, "$1")
    .replace(/::[a-z_][a-z0-9_]*(?:\[\])?/gi, "")
    .replace(/timestamp with time zone/gi, "timestamptz")
    .replace(/timestamp without time zone/gi, "timestamp")
    .toLowerCase();
  const unqualified = dequoted.replace(/\bpublic\./g, "");

  return `${corpus}\n\n-- Dequoted schema contract\n${dequoted}\n\n-- Unqualified schema contract\n${unqualified}`;
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

export function planOutOfOrderMigrations(migrations, appliedVersions) {
  const appliedMigrationVersions = new Set(
    Array.from(appliedVersions, (version) => String(version)),
  );
  const latestAppliedVersion = Array.from(appliedMigrationVersions).sort().at(-1) || "";
  const pendingMigrations = migrations.filter((migration) =>
    migration.version < latestAppliedVersion && !appliedMigrationVersions.has(migration.version)
  );
  const unapprovedMigrations = pendingMigrations.filter((migration) =>
    !approvedOutOfOrderMigrationVersions.has(migration.version)
  );

  return {
    includeAllMigrations: pendingMigrations.length > 0,
    pendingMigrations,
    unapprovedMigrations,
  };
}
