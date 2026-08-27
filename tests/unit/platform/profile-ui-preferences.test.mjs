import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

const workspacePreferences = await loadTranspiledModule(
  "src/features/planning/model/workspace-preferences.ts",
);

const planningProfileMappers = await loadTranspiledModule(
  "src/lib/planning-profile-mappers.ts",
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
      workspacePreferences.rootWorkspaceFromPreference(workspace),
      workspace === "projects" ? "backlog" : workspace,
    );
  }

  assert.equal(workspacePreferences.appWorkspaceFromValue("decision-log"), "decision-log");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("decision-log"), "planning");
});

test("workspace preferences normalize every retired workspace", () => {
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("execution"), "planning");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("mine"), "planning");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("reviews"), "planning");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("decisions"), "planning");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("meetings"), "planning");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("settings"), "notifications");
  assert.equal(workspacePreferences.rootWorkspaceFromPreference("ceo-intake"), "planning");
});

test("new profiles start with neutral planning defaults instead of current controller state", () => {
  const draft = profileSettingsModel.buildInitialDraft({
    currentProfile,
    data: { notificationPreferences: [] },
    profileUiPreference: null,
  });

  assert.equal(draft.defaultWorkspace, "planning");
  assert.equal(draft.defaultTaskView, "board");
  assert.deepEqual(draft.expandedInitiativeIds, []);
  assert.deepEqual(draft.planningFilters, {
    query: "",
    assignee: "Alle",
    status: "Alle",
    priority: "Alle",
    review: "Alle",
    initiativeId: "Alle",
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
      expandedInitiativeIds: ["initiative-1"],
    },
  });

  assert.equal(draft.defaultWorkspace, "planning");
  assert.equal(draft.defaultTaskView, "table");
  assert.deepEqual(draft.planningFilters, planningFilters);
  assert.deepEqual(draft.expandedInitiativeIds, ["initiative-1"]);
});

test("profile preference reads use only canonical planning fields", () => {
  const preference = planningProfileMappers.mapProfileUiPreference({
    profile_id: "profile-1",
    default_workspace: "planning",
    default_task_view: "board",
    planning_filters: { assignee: "profile-2", initiativeId: "initiative-current" },
    expanded_item_ids: ["initiative-1"],
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:00:00.000Z",
  });

  assert.equal(preference.planningFilters.initiativeId, "initiative-current");
  assert.equal(preference.planningFilters.assignee, "profile-2");
  assert.deepEqual(preference.expandedInitiativeIds, ["initiative-1"]);
});


