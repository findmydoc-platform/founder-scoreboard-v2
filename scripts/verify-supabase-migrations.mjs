import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import {
  findDestructiveDdl,
  listSupabaseMigrations,
  migrationFilePattern,
  productionBaseline,
} from "./lib/supabase-migrations.mjs";

const failures = [];
const migrations = await listSupabaseMigrations();
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const config = await readFile("supabase/config.toml", "utf8");
const supabaseEntries = await readdir("supabase", { withFileTypes: true });

if (migrations.length < 2) failures.push("Expected the production baseline and at least one post-baseline migration.");
if (migrations[0]?.file !== productionBaseline.file) {
  failures.push(`${productionBaseline.file} must remain the first migration in the ordered history.`);
}

const versions = new Set();
for (const migration of migrations) {
  if (!migrationFilePattern.test(migration.file)) failures.push(`Invalid migration filename: ${migration.file}`);
  if (!migration.sql.trim()) failures.push(`Migration is empty: ${migration.file}`);
  if (versions.has(migration.version)) failures.push(`Duplicate migration version: ${migration.version}`);
  versions.add(migration.version);

  const destructiveDdl = findDestructiveDdl(migration.sql);
  if (destructiveDdl.length) {
    failures.push(`${migration.file} contains destructive DDL (${destructiveDdl.join(", ")}); use the explicitly approved destructive path.`);
  }
}

const baseline = migrations.find(({ file }) => file === productionBaseline.file);
if (!baseline) failures.push(`Missing immutable production baseline: ${productionBaseline.file}`);
if (baseline && baseline.sha256 !== productionBaseline.sha256) {
  failures.push(`${productionBaseline.file} no longer matches the verified production dump.`);
}

for (const entry of supabaseEntries) {
  if (entry.isFile() && entry.name.endsWith(".sql")) {
    failures.push(`SQL must live under supabase/migrations/: supabase/${entry.name}`);
  }
}

if (existsSync("supabase/rollback")) failures.push("Legacy supabase/rollback directory must stay removed.");
if (packageJson.devDependencies?.supabase !== "2.109.1") failures.push("Supabase CLI must be pinned to exactly 2.109.1.");
if (!/^\[db\.seed\][\s\S]*?^enabled = false$/m.test(config)) failures.push("supabase/config.toml must keep database seeding disabled.");

if (failures.length) {
  console.error(`Supabase migration verification failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(JSON.stringify({
  status: "supabase-migrations-ready",
  baseline: productionBaseline.file,
  migrations: migrations.map(({ file, sha256 }) => ({ file, sha256 })),
  cliVersion: packageJson.devDependencies.supabase,
}, null, 2));
