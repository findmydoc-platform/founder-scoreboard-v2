import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { listSupabaseMigrations } from "../scripts/lib/supabase-migrations.mjs";

test("database hardening removes RLS bypasses without removing authenticated CRUD", async () => {
  const migrations = await listSupabaseMigrations();
  const matchingMigrations = migrations.filter(
    (migration) => migration.name === "harden_database_security",
  );

  assert.equal(matchingMigrations.length, 1);
  const migration = matchingMigrations[0].sql;

  assert.match(
    migration,
    /where profile\.auth_user_id = \(select auth\.uid\(\)\)/i,
  );
  assert.doesNotMatch(migration, /auth\.jwt|user_metadata/i);
  assert.match(
    migration,
    /revoke references, trigger, truncate, maintain\s+on all tables in schema public\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /revoke select, update\s+on all sequences in schema public\s+from public, anon, authenticated/i,
  );

  for (const triggerFunction of [
    "allocate_milestone_sort_order",
    "normalize_task_approval_state",
    "touch_milestone_updated_at",
    "touch_package_updated_at",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke execute on function public\\.${triggerFunction}\\(\\)\\s+from public, anon, authenticated`,
        "i",
      ),
    );
  }

  for (const helper of [
    "current_platform_role",
    "current_profile_id",
    "current_profile_role",
  ]) {
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${helper}\\(\\) to authenticated`, "i"),
    );
  }

  assert.doesNotMatch(
    migration,
    /revoke (?:all privileges|select|insert|update|delete)[^;]*on all tables in schema public[^;]*authenticated/i,
  );
  assert.match(
    migration,
    /alter default privileges for role postgres in schema public\s+revoke all privileges on tables from public, anon, authenticated/i,
  );

  for (const policyName of [
    "fmd_tools_insert_team",
    "fmd_tools_update_team",
  ]) {
    const policyStatement = migration.match(
      new RegExp(`alter policy ${policyName}[\\s\\S]*?;`, "i"),
    )?.[0];
    assert.ok(policyStatement, `${policyName} must be hardened`);
    assert.match(policyStatement, /'ceo'::text/);
    assert.match(policyStatement, /'founder'::text/);
    assert.match(policyStatement, /'deputy'::text/);
    assert.doesNotMatch(policyStatement, /viewer/i);
  }
});

test("server authorization no longer falls back to mutable GitHub metadata", async () => {
  const authz = await readFile("src/lib/authz.ts", "utf8");

  assert.match(authz, /\.eq\("auth_user_id", user\.id\)/);
  assert.doesNotMatch(authz, /user\.user_metadata/);
  assert.doesNotMatch(authz, /\.ilike\("github_login"/);
  assert.doesNotMatch(authz, /\.is\("auth_user_id", null\)/);
});

test("viewer tool access is read-only across UI and server routes", async () => {
  const [
    permissions,
    overview,
    createRoute,
    updateRoute,
    metadataRoute,
    previewRoute,
  ] = await Promise.all([
    readFile("src/features/tools/model/fmd-quick-links-view.ts", "utf8"),
    readFile("src/features/tools/organisms/fmd-quick-links-overview.tsx", "utf8"),
    readFile("src/app/api/tools/route.ts", "utf8"),
    readFile("src/app/api/tools/[id]/route.ts", "utf8"),
    readFile("src/app/api/tools/metadata/route.ts", "utf8"),
    readFile("src/app/api/tools/preview-image/route.ts", "utf8"),
  ]);

  assert.match(permissions, /currentProfile\.platformRole !== "viewer"/);
  assert.match(overview, /const createAllowed = canEditLinks/);
  assert.match(overview, /Viewer-Zugriff ist schreibgeschützt\./);
  for (const route of [createRoute, updateRoute, metadataRoute, previewRoute]) {
    assert.match(route, /requirePlanningContributor/);
    assert.doesNotMatch(route, /requireTeamMember/);
  }
});

test("the protected production workflow enforces the database security contract", async () => {
  const [workflow, packageJson, verifier] = await Promise.all([
    readFile(".github/workflows/deploy-production.yml", "utf8"),
    readFile("package.json", "utf8"),
    readFile("scripts/verify-database-security.mjs", "utf8"),
  ]);

  assert.match(
    workflow,
    /Apply Supabase Migrations to Production[\s\S]*Verify Production Database Security[\s\S]*pnpm run verify:database-security -- --production/,
  );
  assert.match(
    workflow,
    /Verify Production Database Security[\s\S]*SCHEMA_DEPLOY_TARGET: production[\s\S]*SUPABASE_DB_PASSWORD/,
  );
  assert.match(
    packageJson,
    /"verify:database-security": "node scripts\/verify-database-security\.mjs"/,
  );
  assert.match(verifier, /begin read only/);
  assert.match(verifier, /GITHUB_REF !== "refs\/heads\/main"/);
});
