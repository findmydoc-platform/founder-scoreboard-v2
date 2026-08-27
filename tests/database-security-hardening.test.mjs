import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import * as databaseSecurity from "../scripts/lib/database-security.mjs";





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
  const securityModuleNames = await readdir("scripts/lib/database-security");
  const [workflow, packageJson, verifier, ...securityModules] = await Promise.all([
    readFile(".github/workflows/deploy-production.yml", "utf8"),
    readFile("package.json", "utf8"),
    readFile("scripts/verify-database-security.mjs", "utf8"),
    ...securityModuleNames
      .filter((fileName) => fileName.endsWith(".mjs"))
      .sort()
      .map((fileName) => readFile(`scripts/lib/database-security/${fileName}`, "utf8")),
  ]);
  const securityContract = securityModules.join("\n");

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
  assert.deepEqual(Object.keys(databaseSecurity), ["verifyDatabaseSecurity"]);
  assert.match(
    securityContract,
    /team reads granted to any authenticated session/,
  );
  assert.match(
    securityContract,
    /writes granted to any authenticated session/,
  );
  assert.match(
    securityContract,
    /client roles can mutate authorization profiles directly/,
  );
});
