import assert from "node:assert/strict";
import test from "node:test";
import {
  findMissingRequiredAuthLinkedProfileIds,
  parseRequiredAuthLinkedProfileIds,
} from "../scripts/lib/auth-verification.mjs";
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
