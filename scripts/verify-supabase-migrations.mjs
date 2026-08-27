import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import {
  findUnapprovedDestructiveDdl,
  listSupabaseMigrations,
  migrationFilePattern,
  productionBaseline,
} from "./lib/supabase-migrations.mjs";

const failures = [];
const migrations = await listSupabaseMigrations();
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const config = await readFile("supabase/config.toml", "utf8");
const supabaseEntries = await readdir("supabase", { withFileTypes: true });
const migrationTestEntries = await readdir("tests/migrations", { withFileTypes: true });
const migrationTests = new Set(
  migrationTestEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name),
);

if (migrations.length < 1) failures.push("Expected at least the current schema baseline.");
if (migrations[0]?.file !== productionBaseline.file) {
  failures.push(`${productionBaseline.file} must remain the first migration in the ordered history.`);
}

const versions = new Set();
for (const migration of migrations) {
  if (!migrationFilePattern.test(migration.file)) failures.push(`Invalid migration filename: ${migration.file}`);
  if (!migration.sql.trim()) failures.push(`Migration is empty: ${migration.file}`);
  if (versions.has(migration.version)) failures.push(`Duplicate migration version: ${migration.version}`);
  versions.add(migration.version);

  const expectedTest = `${migration.file.slice(0, -4)}.test.mjs`;
  if (!migrationTests.has(expectedTest)) {
    failures.push(`${migration.file} requires tests/migrations/${expectedTest}.`);
  }

  const unapprovedDestructiveDdl = findUnapprovedDestructiveDdl(migration);
  if (unapprovedDestructiveDdl.length) {
    failures.push(`${migration.file} contains destructive DDL (${unapprovedDestructiveDdl.join(", ")}); use the explicitly approved destructive path.`);
  }
}

for (const migrationTest of migrationTests) {
  const expectedMigration = `${migrationTest.slice(0, -9)}.sql`;
  if (!migrations.some(({ file }) => file === expectedMigration)) {
    failures.push(`Orphaned migration test without matching SQL: tests/migrations/${migrationTest}`);
  }
}

const baseline = migrations.find(({ file }) => file === productionBaseline.file);
if (!baseline) failures.push(`Missing current schema baseline: ${productionBaseline.file}`);
if (baseline && baseline.sha256 !== productionBaseline.sha256) {
  failures.push(`${productionBaseline.file} no longer matches the verified schema baseline.`);
}

for (const entry of supabaseEntries) {
  if (entry.isFile() && entry.name.endsWith(".sql")) {
    failures.push(`SQL must live under supabase/migrations/: supabase/${entry.name}`);
  }
}

if (existsSync("supabase/rollback")) failures.push("Legacy supabase/rollback directory must stay removed.");
if (packageJson.devDependencies?.supabase !== "2.109.1") failures.push("Supabase CLI must be pinned to exactly 2.109.1.");
if (packageJson.scripts?.["test:migrations"] !== "node --test --test-concurrency=1 tests/migrations/*.test.mjs") {
  failures.push("test:migrations must run the migration integration tests serially.");
}
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
