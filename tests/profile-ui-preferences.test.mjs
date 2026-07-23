import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const workspacePreferences = await loadTranspiledModule(
  "src/features/planning/model/workspace-preferences.ts",
);

const icon = () => null;
const workspaceRoutes = await loadTranspiledModule(
  "src/features/planning/model/workspace-routes.ts",
  {
    "lucide-react": {
      Archive: icon,
      Bell: icon,
      BookOpenCheck: icon,
      CalendarClock: icon,
      GanttChart: icon,
      LayoutDashboard: icon,
      Link2: icon,
      ListOrdered: icon,
      UserCircle: icon,
      Users: icon,
      WandSparkles: icon,
    },
    "@/features/planning/model/workspace-preferences": workspacePreferences,
  },
);

const profileSettingsModel = await loadTranspiledModule(
  "src/features/profile/model/profile-settings-view-model.ts",
  {
    "@/lib/notification-policy": { googleChatDigestEventTypes: ["task.created"] },
    "@/features/planning/model/workspace-routes": workspacePreferences,
  },
);

const currentProfile = {
  id: "profile-1",
  name: "Founder",
  platformRole: "founder",
  focus: "",
  color: "#3b82f6",
  notificationsEnabled: true,
};

test("workspace routes include every navigable workspace while persisted defaults stay explicit", () => {
  assert.deepEqual(
    workspaceRoutes.workspaceRoutes.map((route) => route.id),
    [...workspacePreferences.appWorkspaceIds],
  );

  for (const workspace of workspacePreferences.persistedWorkspaceIds) {
    assert.equal(
      workspacePreferences.rootWorkspaceFromPreference(workspace, "ceo"),
      workspace,
    );
  }

  assert.equal(workspacePreferences.appWorkspaceFromValue("decision-log"), "decision-log");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("decision-log", "ceo"), "planning");
});

test("workspace preferences normalize legacy values and role-protected CEO intake", () => {
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("execution", "founder"), "planning");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("mine", "founder"), "planning");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("reviews", "founder"), "planning");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("decisions", "founder"), "planning");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("meetings", "founder"), "planning");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("settings", "founder"), "notifications");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("ceo-intake", "founder"), "planning");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("ceo-intake", "ceo"), "ceo-intake");
});

test("new profiles start with neutral planning defaults instead of current controller state", () => {
  const draft = profileSettingsModel.buildInitialDraft({
    currentProfile,
    data: { notificationPreferences: [] },
    profileUiPreference: null,
  });

  assert.equal(draft.defaultWorkspace, "planning");
  assert.equal(draft.defaultTaskView, "board");
  assert.deepEqual(draft.expandedPackageIds, []);
  assert.deepEqual(draft.planningFilters, {
    query: "",
    assignee: "Alle",
    status: "Alle",
    priority: "Alle",
    review: "Alle",
    packageId: "Alle",
    quick: [],
    sprintId: "Alle",
    workstream: "Alle",
    risk: "Alle",
    targetFrom: "",
    targetTo: "",
    sort: "priority",
    direction: "asc",
  });
});

test("saved profile preferences remain intact while legacy workspaces are normalized", () => {
  const planningFilters = {
    ...profileSettingsModel.defaultFilters(),
    query: "Current default",
    quick: ["open"],
  };
  const draft = profileSettingsModel.buildInitialDraft({
    currentProfile,
    data: { notificationPreferences: [] },
    profileUiPreference: {
      defaultWorkspace: "reviews",
      defaultTaskView: "table",
      planningFilters,
      expandedPackageIds: ["initiative-1"],
    },
  });

  assert.equal(draft.defaultWorkspace, "planning");
  assert.equal(draft.defaultTaskView, "table");
  assert.deepEqual(draft.planningFilters, planningFilters);
  assert.deepEqual(draft.expandedPackageIds, ["initiative-1"]);
});

test("profile settings API delegates workspace validation to the shared role-aware contract", async () => {
  const route = await readFile("src/app/api/profile-settings/route.ts", "utf8");

  assert.match(route, /rootWorkspaceFromPreference\(typeof value === "string" \? value : null, platformRole\)/);
  assert.match(route, /permission\.profile\?\.platformRole/);
  assert.doesNotMatch(route, /allowedWorkspaces/);
});

test("profile settings only offer workspaces supported by the persisted default contract", async () => {
  const profileSettings = await readFile(
    "src/features/profile/organisms/profile-settings-overview.tsx",
    "utf8",
  );

  assert.match(profileSettings, /isPersistedWorkspace\(route\.id\)/);
});

test("workspace constraint migration backfills legacy values and allows every persisted workspace", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721121727_align_profile_ui_default_workspaces.sql",
    "utf8",
  );

  assert.match(migration, /when default_workspace = 'settings' then 'notifications'/);
  assert.match(migration, /else 'planning'/);
  assert.match(migration, /drop constraint if exists profile_ui_preferences_default_workspace_check/);
  assert.match(migration, /add constraint profile_ui_preferences_default_workspace_check/);
  assert.ok(
    migration.indexOf("drop constraint") < migration.indexOf("update public.profile_ui_preferences"),
    "the legacy constraint must be removed before values are normalized",
  );
  assert.ok(
    migration.indexOf("update public.profile_ui_preferences") < migration.indexOf("add constraint"),
    "values must be normalized before the current constraint is installed",
  );
  for (const workspace of workspacePreferences.persistedWorkspaceIds) {
    assert.match(migration, new RegExp(`'${workspace}'`));
  }
  assert.doesNotMatch(migration, /'decision-log'/);
});
