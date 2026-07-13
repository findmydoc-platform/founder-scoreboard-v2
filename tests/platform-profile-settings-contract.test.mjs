import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("profile workspace is hidden from sidebar but reachable from account menu", async () => {
  const routes = await readFile("src/features/planning/model/workspace-routes.ts", "utf8");
  const workspaceHook = await readFile("src/features/planning/hooks/use-planning-workspace.ts", "utf8");
  const authControl = await readFile("src/features/settings/organisms/auth-control.tsx", "utf8");
  const header = await readFile("src/features/planning/organisms/planning-header.tsx", "utf8");
  const renderer = await readFile("src/features/planning/organisms/planning-workspace-renderer.tsx", "utf8");
  const profileSync = await readFile("src/features/profile/hooks/use-profile-ui-preference-sync.ts", "utf8");
  const profileModel = await readFile("src/features/profile/model/profile-settings-view-model.ts", "utf8");
  const profileRoute = await readFile("src/app/api/profile-settings/route.ts", "utf8");

  assert.match(routes, /AppWorkspace = .*"profile"/);
  assert.match(routes, /hiddenWorkspaceIds = \["profile"\]/);
  assert.match(routes, /href: "\/profile"/);
  assert.match(routes, /id: "profile".*hidden: true/s);
  assert.doesNotMatch(routes, /id: "execution"|label: "Execution"/);
  assert.match(workspaceHook, /workspacePath\(nextWorkspace\)/);
  assert.match(routes, /value === "mine" \|\| value === "execution"/);
  assert.match(routes, /rootWorkspaceFromPreference/);
  assert.doesNotMatch(profileSync, /setWorkspace|workspaceFromPathname|appWorkspaceFromValue/);
  assert.match(profileModel, /appWorkspaceFromValue\(value\) \|\| "planning"/);
  assert.match(routes, /value === "settings"\) return "notifications"/);
  assert.match(profileRoute, /value === "settings"\) return "notifications"/);
  assert.doesNotMatch(profileRoute, /"execution",/);
  assert.match(authControl, /Mein Profil/);
  assert.match(authControl, /data-tour-id="account-menu-trigger"/);
  assert.match(authControl, /data-tour-id="profile-menu-link"/);
  assert.match(authControl, /fmd:open-account-menu/);
  assert.match(header, /onOpenProfile=\{\(\) => setWorkspace\("profile"\)\}/);
  assert.match(renderer, /workspace === "profile"/);
  assert.match(renderer, /ProfileSettingsOverview/);
});

test("profile self-service API writes only whitelisted own-profile fields", async () => {
  const route = await readFile("src/app/api/profile-settings/route.ts", "utf8");
  const apiClient = await readFile("src/features/planning/model/planning-api-client.ts", "utf8");
  const ownCommands = await readFile("src/features/profile/hooks/use-own-profile-settings-commands.ts", "utf8");
  const migration = await readFile("supabase/0044_transactional_profile_writes.sql", "utf8");
  const verifySupabase = await readFile("scripts/verify-supabase.mjs", "utf8");

  assert.match(route, /requireTeamMember/);
  assert.match(route, /blockedSelfServiceFields/);
  for (const blocked of ["profileId", "platformRole", "weeklyCapacity", "githubLogin", "deputyFor", "googleChatUserId"]) {
    assert.match(route, new RegExp(`"${blocked}"`));
  }
  for (const allowed of ["focus", "color", "notificationsEnabled"]) {
    assert.match(route, new RegExp(`payload\\.${allowed}`));
  }
  assert.doesNotMatch(route, /googleCalendarEmail|googleCalendarSyncEnabled|googleCalendarLastSyncedAt/);
  assert.match(route, /update_profile_settings_transaction/);
  assert.doesNotMatch(route, /\.from\("profiles"\)[\s\S]*\.update/);
  assert.doesNotMatch(route, /\.from\("profile_ui_preferences"\)/);
  assert.doesNotMatch(route, /\.from\("notification_preferences"\)/);
  assert.doesNotMatch(route, /context\.params/);
  assert.match(apiClient, /updateOwnProfileSettingsRequest/);
  assert.match(ownCommands, /updateOwnProfileSettingsRequest/);
  assert.match(migration, /update_profile_settings_transaction/);
  assert.match(migration, /security definer/);
  assert.match(migration, /grant execute on function public\.update_profile_settings_transaction[\s\S]*to service_role/);
  assert.match(verifySupabase, /verifyProfileWriteRpcs/);
});

test("CEO transfer and managed notification preferences use one transaction", async () => {
  const route = await readFile("src/app/api/profiles/[id]/route.ts", "utf8");
  const commands = await readFile("src/features/team/hooks/use-profile-settings-commands.ts", "utf8");
  const apiClient = await readFile("src/features/planning/model/planning-api-client.ts", "utf8");
  const migration = await readFile("supabase/0044_transactional_profile_writes.sql", "utf8");

  assert.match(route, /requireCEO/);
  assert.match(route, /update_profile_admin_transaction/);
  assert.match(route, /p_notification_events: notificationEvents/);
  assert.doesNotMatch(route, /demoteError|\.neq\("id", id\)/);
  assert.doesNotMatch(route, /await supabase\.from\("audit_log"\)\.insert/);
  assert.match(commands, /notificationEvents: Object\.fromEntries\(changedNotificationEvents\)/);
  assert.doesNotMatch(commands, /updateNotificationPreferenceRequest/);
  assert.doesNotMatch(apiClient, /updateNotificationPreferenceRequest/);
  assert.match(migration, /lock table public\.profiles in share row exclusive mode/);
  assert.match(migration, /exactly one CEO is required/);
  assert.match(migration, /update_profile_admin_transaction/);
  assert.match(migration, /upsert_profile_notification_preferences/);
  assert.match(migration, /insert into public\.audit_log/);
  assert.doesNotMatch(migration, /drop table|truncate|delete from|drop column/i);
});

test("profile preferences and feature tour acknowledgements are additive data slices", async () => {
  const migration = await readFile("supabase/0037_profile_preferences_feature_tours.sql", "utf8");
  const loader = await readFile("src/lib/planning-data-loader.ts", "utf8");
  const types = await readFile("src/lib/types.ts", "utf8");
  const schemaChecks = await readFile("src/lib/planning-schema-checks.json", "utf8");

  assert.match(migration, /create table if not exists profile_ui_preferences/);
  assert.match(migration, /create table if not exists profile_feature_tour_acknowledgements/);
  assert.match(migration, /profile_ui_preferences_write_self/);
  assert.match(migration, /profile_feature_tour_acknowledgements_write_self/);
  assert.match(migration, /current_platform_role\(\) in \('ceo', 'deputy'\)/);
  assert.doesNotMatch(migration, /drop table|truncate|delete from|drop column/i);

  assert.match(loader, /profileUiPreferenceResult/);
  assert.match(loader, /profileFeatureTourAcknowledgementResult/);
  assert.match(loader, /mapProfileUiPreference/);
  assert.match(loader, /mapProfileFeatureTourAcknowledgement/);
  assert.match(types, /profileUiPreferences: ProfileUiPreference\[\]/);
  assert.match(types, /profileFeatureTourAcknowledgements: ProfileFeatureTourAcknowledgement\[\]/);
  assert.match(schemaChecks, /profile_ui_preferences/);
  assert.match(schemaChecks, /profile_feature_tour_acknowledgements/);
});

test("URL filters hydrate without silently changing saved profile defaults", async () => {
  const profileSync = await readFile("src/features/profile/hooks/use-profile-ui-preference-sync.ts", "utf8");
  const profileBoard = await readFile("src/features/profile/molecules/profile-board-section.tsx", "utf8");

  assert.match(profileSync, /if \(!hasPlanningFilterUrlState\)/);
  assert.doesNotMatch(profileSync, /updateProfileUiPreferenceRequest|saveProfileUiPreference|planningFilters:/);
  assert.match(profileBoard, /onCurrentBoardSave/);
  assert.match(profileBoard, /Aktuelle Board-Ansicht als Standard speichern/);
});

test("driver tour waits for rendered targets and acknowledges only after popover render", async () => {
  const registry = await readFile("src/features/product-tours/model/feature-tour-registry.ts", "utf8");
  const selection = await readFile("src/features/product-tours/model/feature-tour-selection.ts", "utf8");
  const provider = await readFile("src/features/product-tours/organisms/feature-tour-provider.tsx", "utf8");
  const header = await readFile("src/features/planning/organisms/planning-header.tsx", "utf8");
  const client = await readFile("src/features/planning/model/planning-api-client.ts", "utf8");

  assert.match(registry, /workspace-cleanup-v2/);
  assert.match(registry, /backlog-prioritization-v1/);
  assert.match(registry, /workspaceScope: "backlog"/);
  assert.match(registry, /backlog-overview/);
  assert.match(registry, /backlog-scope-tabs/);
  assert.match(registry, /backlog-rank-table/);
  assert.match(registry, /backlog-sprint-pane/);
  assert.match(registry, /Vorschläge sind aus dem Planning-Board raus/);
  assert.match(registry, /workspace-nav-planning/);
  assert.match(registry, /workspace-nav-sprint/);
  assert.match(registry, /profile-settings-v1/);
  assert.match(registry, /planning-my-tasks-scope-v1/);
  assert.match(registry, /account-menu-trigger/);
  assert.match(registry, /profile-menu-link/);
  assert.match(registry, /Navigation bereinigt/);
  assert.match(registry, /Meeting Finder und Decision Log/);
  assert.match(registry, /neu gedachte Aggregation/);
  assert.match(registry, /Kalender und Verfügbarkeit sind aus dem Profil raus/);
  assert.match(selection, /tourAppliesToWorkspace/);
  assert.match(selection, /tour\.workspaceScope === workspace/);
  assert.match(selection, /profileHasSeenTour/);
  assert.match(selection, /selectNextFeatureTour/);
  assert.match(selection, /tours\.find/);
  assert.match(header, /HelpCircle/);
  assert.match(header, /fmd:start-feature-tour/);
  assert.match(header, /Hilfe anzeigen/);
  assert.match(provider, /window\.addEventListener\("fmd:start-feature-tour"/);
  assert.match(provider, /tourRequested/);
  assert.match(provider, /if \(!tourRequested \|\| !tour/);
  assert.match(provider, /MutationObserver/);
  assert.match(provider, /selectNextFeatureTour\(featureTours, workspace/);
  assert.doesNotMatch(provider, /targetWorkspace/);
  assert.match(provider, /waitForElement\(activeTour\.requiredSelectors\[0\]\)/);
  assert.match(provider, /waitForElement\(activeTour\.requiredSelectors\[1\]\)/);
  assert.match(provider, /fmd:open-account-menu/);
  assert.match(provider, /onPopoverRender/);
  assert.match(provider, /if \(index === 0\) markSeen\(\)/);
  assert.match(provider, /setWorkspace\(activeTour\.doneWorkspace\)/);
  assert.match(client, /markProfileFeatureTourSeenRequest/);
});

test("profile settings no longer expose calendar or availability sections", async () => {
  const profileUi = await readFile("src/features/profile/organisms/profile-settings-overview.tsx", "utf8");
  const profileModel = await readFile("src/features/profile/model/profile-settings-view-model.ts", "utf8");
  const profileLayout = await readFile("src/features/profile/molecules/profile-settings-layout.tsx", "utf8");

  assert.doesNotMatch(profileUi, /MeetingAvailability|ProfileAvailability|Calendar|googleCalendar/);
  assert.doesNotMatch(profileModel, /calendar|availability|googleCalendar/i);
  assert.doesNotMatch(profileLayout, /Kalender|Verfügbarkeit|Calendar|Clock/);
});

test("profile settings use slim section navigation and dirty-only save UX", async () => {
  const profileUi = await readFile("src/features/profile/organisms/profile-settings-overview.tsx", "utf8");
  const profileModel = await readFile("src/features/profile/model/profile-settings-view-model.ts", "utf8");
  const profileLayout = await readFile("src/features/profile/molecules/profile-settings-layout.tsx", "utf8");
  const profileBoard = await readFile("src/features/profile/molecules/profile-board-section.tsx", "utf8");

  assert.match(profileModel, /type ProfileSettingsSectionId = "profile" \| "notifications" \| "board"/);
  assert.match(profileModel, /type ProfileSettingsDraft =/);
  assert.match(profileLayout, /profileSettingsSections/);
  assert.match(profileUi, /data-profile-settings-section=\{activeSection\}/);
  assert.match(profileUi, /useState<ProfileSettingsSectionId>\("profile"\)/);
  assert.match(profileUi, /useState\(false\)/);
  assert.match(profileBoard, /data-profile-advanced-board-defaults=\{advancedBoardOpen \? "open" : "closed"\}/);
  assert.match(profileBoard, /Aktuelle Board-Ansicht als Standard speichern/);
  assert.match(profileUi, /\(isDirty \|\| message\) &&/);
  assert.match(profileUi, /data-profile-save-bar/);
  assert.match(profileUi, /Ungespeicherte Änderungen/);
});

test("team overview no longer edits personal self-service settings", async () => {
  const team = await readFile("src/features/team/organisms/team-overview.tsx", "utf8");
  const teamCard = await readFile("src/features/team/molecules/team-member-card.tsx", "utf8");
  const teamDialog = await readFile("src/features/team/organisms/team-profile-edit-dialog.tsx", "utf8");
  const teamModel = await readFile("src/features/team/model/team-profile-view-model.ts", "utf8");

  assert.match(team, /TeamMemberCard/);
  assert.match(team, /TeamProfileEditDialog/);
  assert.match(teamCard, /Bearbeiten/);
  assert.match(teamCard, /Offene Aufgaben/);
  assert.match(teamCard, /P0\/P1 offen/);
  assert.match(teamCard, /Geplante Last/);
  assert.match(teamCard, /Wochenkapazität/);
  assert.match(teamCard, /Info/);
  assert.match(teamCard, /title=\{definition\.description\}/);
  assert.match(teamCard, /aria-label=\{definition\.description\}/);
  assert.doesNotMatch(teamCard, /role="tooltip"/);
  assert.doesNotMatch(teamCard, /group-hover:block/);
  assert.match(teamCard, /lg:grid-cols-\[minmax\(220px,0\.8fr\)_minmax\(520px,2fr\)_auto\]/);
  assert.match(teamCard, /whitespace-nowrap/);
  assert.match(teamCard, /Aufgaben dieser Person, die noch nicht erledigt sind/);
  assert.match(teamCard, /Offene P0- und P1-Aufgaben dieser Person/);
  assert.match(teamCard, /profile\.color/);
  assert.match(teamCard, /backgroundColor: memberColor/);
  assert.ok(teamCard.indexOf("{profile.name}") < teamCard.indexOf("roleLabel(profile)"), "role badge should sit next to the profile name");
  assert.doesNotMatch(teamCard, /Google-Chat-Benachrichtigungen/);
  assert.doesNotMatch(teamCard, /Kalender-E-Mail/);
  assert.doesNotMatch(teamCard, /Post-it-Farbe/);
  assert.doesNotMatch(teamCard, /GitHub-Login/);
  assert.doesNotMatch(teamCard, /UiTextArea/);
  assert.match(teamDialog, /if \(!canManageTeam\) return null/);
  assert.match(teamDialog, /Plattformrolle/);
  assert.match(teamDialog, /Org-Rolle/);
  assert.match(teamDialog, /GitHub-Login/);
  assert.match(teamDialog, /Kapazität/);
  assert.match(teamDialog, /Vertreter für/);
  assert.match(teamDialog, /draftProfile\.platformRole === "deputy"/);
  for (const field of ["notificationsEnabled", "googleCalendarSyncEnabled", "googleCalendarEmail", "focus", "color"]) {
    assert.doesNotMatch(teamModel, new RegExp(`"${field}"`));
  }
});
