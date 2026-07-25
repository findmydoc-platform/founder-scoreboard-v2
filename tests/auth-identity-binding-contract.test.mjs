import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  findMissingRequiredAuthLinkedProfileIds,
  parseRequiredAuthLinkedProfileIds,
} from "../scripts/lib/auth-verification.mjs";
import { listSupabaseMigrations } from "../scripts/lib/supabase-migrations.mjs";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

async function loadAuthz() {
  return loadTranspiledModule("src/lib/authz.ts", {
    "./local-development-auth": {
      isLocalLoginRequestAllowed: () => false,
    },
    "./platform": {
      isOperationalLeadRole: (role) => role === "ceo" || role === "deputy",
    },
    "./supabase": {
      getSupabaseForToken: () => null,
      requiresSupabaseAuth: () => true,
    },
  });
}

function profileQueryClient({ authProfile = null } = {}) {
  const queries = [];

  return {
    queries,
    from(table) {
      assert.equal(table, "profiles");
      const filters = [];
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          filters.push(["eq", column, value]);
          return query;
        },
        async maybeSingle() {
          queries.push(filters);
          return { data: authProfile, error: null };
        },
      };
      return query;
    },
  };
}

test("required Auth profile verification is deterministic and fail closed", () => {
  assert.deepEqual(parseRequiredAuthLinkedProfileIds(), []);
  assert.deepEqual(
    parseRequiredAuthLinkedProfileIds(" sebastian,volkan,sebastian "),
    ["sebastian", "volkan"],
  );

  const profiles = [
    { id: "sebastian", auth_user_id: "auth-sebastian" },
    { id: "volkan", auth_user_id: null },
    { id: "other", auth_user_id: "stale-auth-user" },
  ];
  const authUserIds = new Set(["auth-sebastian"]);

  assert.deepEqual(
    findMissingRequiredAuthLinkedProfileIds(
      profiles,
      authUserIds,
      ["sebastian", "volkan", "missing"],
    ),
    ["volkan", "missing"],
  );
});

test("Sebastian pilot binds one stable GitHub identity without trusting user metadata", async () => {
  const [migrations, workflow] = await Promise.all([
    listSupabaseMigrations(),
    readFile(".github/workflows/deploy-production.yml", "utf8"),
  ]);
  const matchingMigrations = migrations.filter(
    (migration) => migration.name === "bind_sebastian_auth_identity",
  );

  assert.equal(matchingMigrations.length, 1);

  const migration = matchingMigrations[0].sql;
  assert.match(migration, /where profile\.id = 'sebastian'/i);
  assert.match(migration, /lower\('SebastianSchuetze'\)/i);
  assert.match(migration, /from auth\.identities/i);
  assert.match(migration, /identity_row\.provider = 'github'/i);
  assert.match(migration, /identity_row\.provider_id = '7256168'/i);
  assert.match(migration, /v_identity_count <> 1/i);
  assert.match(migration, /v_existing_auth_user_id <> v_auth_user_id/i);
  assert.match(migration, /profile\.auth_user_id = v_auth_user_id[\s\S]*profile\.id <> 'sebastian'/i);
  assert.match(migration, /auth_user_id is distinct from v_auth_user_id/i);
  assert.doesNotMatch(migration, /user_metadata|raw_user_meta_data|identity_data/i);

  assert.match(
    workflow,
    /Verify Production Auth Mapping[\s\S]*REQUIRED_AUTH_LINKED_PROFILE_IDS: sebastian,volkan,anil,ozen,youssef[\s\S]*pnpm run verify:auth/,
  );
});

test("remaining team profiles bind atomically through stable GitHub identities", async () => {
  const migrations = await listSupabaseMigrations();
  const matchingMigrations = migrations.filter(
    (migration) => migration.name === "bind_remaining_auth_identities",
  );

  assert.equal(matchingMigrations.length, 1);

  const migration = matchingMigrations[0].sql;
  const expectedBindings = [
    ["sebastian", "SebastianSchuetze", "7256168"],
    ["volkan", "MehmetVolkan", "186458176"],
    ["anil", "AnilG24", "186387364"],
    ["ozen", "OezenG", "187222752"],
    ["youssef", "YoussefAdlah", "186973821"],
  ];

  for (const [profileId, githubLogin, providerId] of expectedBindings) {
    assert.match(
      migration,
      new RegExp(`\\('${profileId}'::text, '${githubLogin}'::text, '${providerId}'::text\\)`),
    );
  }

  assert.match(migration, /v_target_profile_count <> 5/i);
  assert.match(migration, /from auth\.identities/i);
  assert.match(migration, /identity_row\.provider = 'github'/i);
  assert.match(migration, /identity_row\.provider_id = v_target\.provider_id/i);
  assert.match(migration, /v_identity_count <> 1/i);
  assert.match(migration, /v_existing_auth_user_id <> v_auth_user_id/i);
  assert.match(migration, /profile\.auth_user_id = v_auth_user_id[\s\S]*profile\.id <> v_target\.profile_id/i);
  assert.match(migration, /auth_user_id is distinct from v_auth_user_id/i);
  assert.match(migration, /profile\.auth_user_id is not null[\s\S]*\) <> 5/i);
  assert.doesNotMatch(migration, /user_metadata|raw_user_meta_data|identity_data/i);
});

test("authorization requires the stable Auth user id and ignores user metadata", async () => {
  const { requirePlatformRoleForUser } = await loadAuthz();
  const githubMetadataUser = {
    id: "unrelated-auth-user",
    user_metadata: { user_name: "SebastianSchuetze" },
  };
  const boundClient = profileQueryClient();

  const boundResult = await requirePlatformRoleForUser(
    boundClient,
    githubMetadataUser,
    ["founder"],
  );

  assert.deepEqual(boundResult, {
    ok: false,
    status: 403,
    error: "GitHub-User ist keinem Teamprofil zugeordnet.",
  });
  assert.deepEqual(boundClient.queries, [
    [["eq", "auth_user_id", "unrelated-auth-user"]],
  ]);

  const linkedProfile = {
    id: "linked-founder",
    name: "Linked Founder",
    platform_role: "founder",
    github_login: "StableFounder",
  };
  const linkedClient = profileQueryClient({ authProfile: linkedProfile });
  const linkedResult = await requirePlatformRoleForUser(
    linkedClient,
    {
      id: "linked-auth-user",
      user_metadata: { user_name: "AttackerControlledMetadata" },
    },
    ["founder"],
  );

  assert.deepEqual(linkedResult, {
    ok: true,
    profile: {
      id: "linked-founder",
      name: "Linked Founder",
      platformRole: "founder",
      githubLogin: "StableFounder",
    },
  });
  assert.deepEqual(linkedClient.queries, [
    [["eq", "auth_user_id", "linked-auth-user"]],
  ]);
});
