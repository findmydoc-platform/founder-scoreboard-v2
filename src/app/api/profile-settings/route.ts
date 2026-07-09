import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanOptionalText } from "@/lib/api-input";
import { requireTeamMember } from "@/lib/authz";
import { mapNotificationPreference, mapProfile, mapProfileUiPreference } from "@/lib/planning-data-mappers";
import type { DbNotificationPreference, DbProfile, DbProfileUiPreference } from "@/lib/planning-data-row-types";
import { googleChatDigestEventTypes } from "@/lib/notification-policy";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import type { PlanningFilterPreferences, ProfileUiPreference, ViewMode } from "@/lib/types";

type UiPreferencesPayload = Partial<{
  defaultWorkspace: string;
  defaultTaskView: ViewMode;
  planningFilters: Partial<PlanningFilterPreferences>;
  expandedPackageIds: string[];
}>;

type ProfileSettingsPayload = Partial<{
  profileId: string;
  role: string;
  platformRole: string;
  orgRole: string;
  githubLogin: string;
  weeklyCapacity: number;
  deputyFor: string;
  deputyActiveFrom: string;
  deputyActiveUntil: string;
  googleChatUserId: string;
  googleChatDmSpace: string;
  focus: string;
  color: string;
  notificationsEnabled: boolean;
  notificationEvents: Record<string, boolean>;
  uiPreferences: UiPreferencesPayload;
}>;

const blockedSelfServiceFields = new Set([
  "profileId",
  "role",
  "platformRole",
  "orgRole",
  "githubLogin",
  "weeklyCapacity",
  "deputyFor",
  "deputyActiveFrom",
  "deputyActiveUntil",
  "googleChatUserId",
  "googleChatDmSpace",
]);
const allowedEventTypes = new Set<string>(googleChatDigestEventTypes);
const allowedWorkspaces = new Set([
  "planning",
  "mine",
  "reviews",
  "events",
  "sprint",
  "projects",
  "tools",
  "team",
  "notifications",
  "ceo-intake",
  "profile",
]);
const allowedTaskViews = new Set<ViewMode>(["board", "structure", "table", "gantt"]);
const defaultPlanningFilters: PlanningFilterPreferences = {
  query: "",
  assignee: "Alle",
  status: "Alle",
  priority: "Alle",
  packageId: "Alle",
  quick: "",
};

function cleanColor(value: unknown) {
  if (typeof value !== "string") return undefined;
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : undefined;
}

function cleanBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function cleanFilters(value: unknown): PlanningFilterPreferences {
  if (!value || typeof value !== "object") return defaultPlanningFilters;
  const candidate = value as Partial<Record<keyof PlanningFilterPreferences, unknown>> & { owner?: unknown };
  return {
    query: typeof candidate.query === "string" ? candidate.query.slice(0, 120) : defaultPlanningFilters.query,
    assignee: typeof candidate.assignee === "string" ? candidate.assignee.slice(0, 120) : typeof candidate.owner === "string" ? candidate.owner.slice(0, 120) : defaultPlanningFilters.assignee,
    status: typeof candidate.status === "string" ? candidate.status.slice(0, 80) : defaultPlanningFilters.status,
    priority: typeof candidate.priority === "string" ? candidate.priority.slice(0, 20) : defaultPlanningFilters.priority,
    packageId: typeof candidate.packageId === "string" ? candidate.packageId.slice(0, 160) : defaultPlanningFilters.packageId,
    quick: typeof candidate.quick === "string" ? candidate.quick.slice(0, 80) : defaultPlanningFilters.quick,
  };
}

function cleanPackageIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 200);
}

function cleanDefaultWorkspace(value: unknown) {
  if (value === "settings") return "notifications";
  return typeof value === "string" && allowedWorkspaces.has(value) ? value : "planning";
}

function databaseStatus(error: { code?: string; message?: string } | null) {
  return error?.code === "42P01" ? 503 : 500;
}

export async function PATCH(request: NextRequest) {
  const context = await requireJsonApiContext<ProfileSettingsPayload>(request, requireTeamMember, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  const profileId = permission.profile?.id || "";
  if (!profileId) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const blockedField = Object.keys(payload).find((key) => blockedSelfServiceFields.has(key));
  if (blockedField) return apiError(`Feld ist nicht im Profil-Self-Service erlaubt: ${blockedField}.`, 400);

  const profileUpdate: Record<string, string | boolean | null> = {};
  if (payload.focus !== undefined) profileUpdate.focus = cleanOptionalText(payload.focus, 240) || null;
  if (payload.color !== undefined) {
    const color = cleanColor(payload.color);
    if (!color) return apiError("Ungültige Profilfarbe.", 400);
    profileUpdate.profile_color = color;
  }
  if (payload.notificationsEnabled !== undefined) {
    const value = cleanBoolean(payload.notificationsEnabled);
    if (value === undefined) return apiError("Benachrichtigungsstatus ist ungültig.", 400);
    profileUpdate.notifications_enabled = value;
  }
  let profile: ReturnType<typeof mapProfile> | undefined;
  if (Object.keys(profileUpdate).length) {
    const { data: profileRow, error } = await supabase
      .from("profiles")
      .update(profileUpdate)
      .eq("id", profileId)
      .select("id,name,role,platform_role,org_role,github_login,deputy_for,deputy_active_from,deputy_active_until,focus,weekly_capacity,profile_color,google_chat_user_id,google_chat_dm_space,notifications_enabled")
      .single<DbProfile>();
    if (error) return apiError(error.message, 500);
    profile = mapProfile(profileRow);
  }

  let uiPreference: ProfileUiPreference | undefined;
  if (payload.uiPreferences && typeof payload.uiPreferences === "object") {
    const uiPayload = payload.uiPreferences;
    const defaultWorkspace = cleanDefaultWorkspace(uiPayload.defaultWorkspace);
    const defaultTaskView = allowedTaskViews.has(uiPayload.defaultTaskView as ViewMode)
      ? uiPayload.defaultTaskView as ViewMode
      : "board";
    const { data: uiPreferenceRow, error } = await supabase
      .from("profile_ui_preferences")
      .upsert({
        profile_id: profileId,
        default_workspace: defaultWorkspace,
        default_task_view: defaultTaskView,
        planning_filters: cleanFilters(uiPayload.planningFilters),
        expanded_package_ids: cleanPackageIds(uiPayload.expandedPackageIds),
        updated_at: new Date().toISOString(),
      }, { onConflict: "profile_id" })
      .select("profile_id,default_workspace,default_task_view,planning_filters,expanded_package_ids,created_at,updated_at")
      .single<DbProfileUiPreference>();
    if (error) return apiError(error.message, databaseStatus(error));
    uiPreference = mapProfileUiPreference(uiPreferenceRow);
  }

  const savedPreferences = [];
  if (payload.notificationEvents && typeof payload.notificationEvents === "object") {
    for (const [eventType, enabled] of Object.entries(payload.notificationEvents)) {
      if (!allowedEventTypes.has(eventType)) return apiError("Unbekannter Benachrichtigungstyp.", 400);
      if (typeof enabled !== "boolean") return apiError("Benachrichtigungsstatus ist erforderlich.", 400);
      const { data: preferenceRow, error } = await supabase
        .from("notification_preferences")
        .upsert({
          profile_id: profileId,
          channel: "google_chat",
          event_type: eventType,
          enabled,
          updated_at: new Date().toISOString(),
        }, { onConflict: "profile_id,channel,event_type" })
        .select("id,profile_id,channel,event_type,enabled")
        .single<DbNotificationPreference>();
      if (error) return apiError(error.message, databaseStatus(error));
      savedPreferences.push(mapNotificationPreference(preferenceRow));
    }
  }

  await supabase.from("audit_log").insert({
    actor_profile_id: profileId,
    action: "profile.self_service.update",
    entity_type: "profile",
    entity_id: profileId,
    after_data: {
      profile: profileUpdate,
      uiPreference: uiPreference || null,
      notificationEvents: payload.notificationEvents || null,
    },
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({
    profile,
    uiPreference,
    notificationPreferences: savedPreferences,
  });
}
