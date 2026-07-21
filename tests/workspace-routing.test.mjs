import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const workspacePreferences = await loadTranspiledModule(
  "src/features/planning/model/workspace-preferences.ts",
);

const { rootWorkspaceFromPreference } = workspacePreferences;

test("root workspace preferences normalize legacy values without accepting route queries", () => {
  assert.equal(rootWorkspaceFromPreference("reviews", "founder"), "planning");
  assert.equal(rootWorkspaceFromPreference("profile", "viewer"), "profile");
  assert.equal(rootWorkspaceFromPreference("mine", "founder"), "planning");
  assert.equal(rootWorkspaceFromPreference("execution", "founder"), "planning");
  assert.equal(rootWorkspaceFromPreference("settings", "founder"), "notifications");
  assert.equal(rootWorkspaceFromPreference("unknown", "ceo"), "planning");
  assert.equal(rootWorkspaceFromPreference(undefined, "ceo"), "planning");
});

test("legacy review URLs use permanent incoming redirects", async () => {
  const nextConfig = await readFile("next.config.ts", "utf8");

  assert.match(nextConfig, /source: "\/reviews"[\s\S]*destination: "\/planning\?tasks\.review=requested"[\s\S]*permanent: true/);
  assert.match(nextConfig, /source: "\/reviews\/:id"[\s\S]*destination: "\/tasks\/:id"[\s\S]*permanent: true/);
});

test("CEO intake can only be selected as a root workspace by a CEO", () => {
  assert.equal(rootWorkspaceFromPreference("ceo-intake", "ceo"), "ceo-intake");
  assert.equal(rootWorkspaceFromPreference("ceo-intake", "deputy"), "planning");
  assert.equal(rootWorkspaceFromPreference("ceo-intake", "founder"), "planning");
  assert.equal(rootWorkspaceFromPreference("ceo-intake", "viewer"), "planning");
});

function recordingSupabase({ defaultWorkspace = "reviews", preferenceError = null } = {}) {
  const calls = [];
  const query = {
    select(columns) {
      calls.push(["select", columns]);
      return query;
    },
    eq(column, value) {
      calls.push(["eq", column, value]);
      return query;
    },
    async maybeSingle() {
      calls.push(["maybeSingle"]);
      return {
        data: preferenceError ? null : { default_workspace: defaultWorkspace },
        error: preferenceError,
      };
    },
  };

  return {
    calls,
    auth: {
      async getUser() {
        return { data: { user: { id: "auth-user", user_metadata: {} } }, error: null };
      },
    },
    from(table) {
      calls.push(["from", table]);
      return query;
    },
  };
}

async function loadPlanningAuthServer({ supabase, authzResult }) {
  return loadTranspiledModule("src/lib/planning-auth-server.ts", {
    "@/features/planning/model/workspace-routes": workspacePreferences,
    "./authz": {
      async requirePlatformRoleForUser() {
        return authzResult;
      },
    },
    "./supabase-server": {
      async getServerAuthSupabase() {
        return supabase;
      },
    },
  });
}

test("home workspace is loaded for the authenticated mapped profile", async () => {
  const supabase = recordingSupabase({ defaultWorkspace: "reviews" });
  const planningAuth = await loadPlanningAuthServer({
    supabase,
    authzResult: {
      ok: true,
      profile: { id: "profile-1", name: "Founder", platformRole: "founder", githubLogin: "founder" },
    },
  });

  assert.equal(await planningAuth.getServerPlanningHomeWorkspace(), "planning");
  assert.deepEqual(supabase.calls, [
    ["from", "profile_ui_preferences"],
    ["select", "default_workspace"],
    ["eq", "profile_id", "profile-1"],
    ["maybeSingle"],
  ]);
});

test("home workspace fails closed when profile authorization or preference loading fails", async () => {
  const unauthorizedSupabase = recordingSupabase();
  const unauthorizedPlanningAuth = await loadPlanningAuthServer({
    supabase: unauthorizedSupabase,
    authzResult: { ok: false, status: 403, error: "Keine Berechtigung." },
  });
  assert.equal(await unauthorizedPlanningAuth.getServerPlanningHomeWorkspace(), "planning");
  assert.deepEqual(unauthorizedSupabase.calls, []);

  const failingSupabase = recordingSupabase({ preferenceError: { message: "unavailable" } });
  const failingPlanningAuth = await loadPlanningAuthServer({
    supabase: failingSupabase,
    authzResult: {
      ok: true,
      profile: { id: "profile-1", name: "CEO", platformRole: "ceo", githubLogin: "ceo" },
    },
  });
  assert.equal(await failingPlanningAuth.getServerPlanningHomeWorkspace(), "planning");
});
