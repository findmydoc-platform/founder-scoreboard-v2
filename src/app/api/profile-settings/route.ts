import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanOptionalText } from "@/lib/api-input";
import { requireTeamMember } from "@/lib/authz";
import { mapNotificationPreference, mapProfile, mapProfileUiPreference } from "@/lib/planning-data-mappers";
import type { DbNotificationPreference, DbProfile, DbProfileUiPreference } from "@/lib/planning-data-row-types";
import { googleChatDigestEventTypes } from "@/lib/notification-policy";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import type { PlanningFilterPreferences, ViewMode } from "@/lib/types";

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

type ProfileSettingsTransactionResult = {
  profile?: DbProfile;
  ui_preference?: DbProfileUiPreference | null;
  notification_preferences?: DbNotificationPreference[];
};

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
  quick: [],
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
    quick: Array.isArray(candidate.quick)
      ? candidate.quick.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 80)).slice(0, 12)
      : typeof candidate.quick === "string" && candidate.quick
        ? [candidate.quick.slice(0, 80)]
        : defaultPlanningFilters.quick,
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
  let uiPreferenceUpdate: Record<string, unknown> | null = null;
  if (payload.uiPreferences !== undefined) {
    if (!payload.uiPreferences || typeof payload.uiPreferences !== "object") {
      return apiError("UI-Einstellungen sind ungültig.", 400);
    }
    const uiPayload = payload.uiPreferences;
    const defaultWorkspace = cleanDefaultWorkspace(uiPayload.defaultWorkspace);
    const defaultTaskView = allowedTaskViews.has(uiPayload.defaultTaskView as ViewMode)
      ? uiPayload.defaultTaskView as ViewMode
      : "board";
    uiPreferenceUpdate = {
      default_workspace: defaultWorkspace,
      default_task_view: defaultTaskView,
      planning_filters: cleanFilters(uiPayload.planningFilters),
      expanded_package_ids: cleanPackageIds(uiPayload.expandedPackageIds),
    };
  }

  const notificationEvents: Record<string, boolean> = {};
  if (payload.notificationEvents !== undefined) {
    if (!payload.notificationEvents || typeof payload.notificationEvents !== "object") {
      return apiError("Benachrichtigungseinstellungen sind ungültig.", 400);
    }
    for (const [eventType, enabled] of Object.entries(payload.notificationEvents)) {
      if (!allowedEventTypes.has(eventType)) return apiError("Unbekannter Benachrichtigungstyp.", 400);
      if (typeof enabled !== "boolean") return apiError("Benachrichtigungsstatus ist erforderlich.", 400);
      notificationEvents[eventType] = enabled;
    }
  }

  const metadata = auditRequestMetadata(request);
  const { data: transactionData, error: transactionError } = await supabase.rpc("update_profile_settings_transaction", {
    p_profile_id: profileId,
    p_profile_patch: profileUpdate,
    p_ui_preferences: uiPreferenceUpdate,
    p_notification_events: notificationEvents,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent,
  });

  if (transactionError) {
    if (transactionError.code === "P0002") return apiError("Profil wurde nicht gefunden.", 404);
    if (transactionError.code === "22023" || transactionError.code === "23514") {
      return apiError("Profileinstellungen sind ungültig.", 400);
    }
    return apiError(transactionError.message, transactionError.code === "42P01" ? 503 : 500);
  }

  const result = transactionData as ProfileSettingsTransactionResult | null;
  if (!result?.profile) return apiError("Profil konnte nicht gespeichert werden.", 500);

  const profile = mapProfile(result.profile);
  const uiPreference = result.ui_preference ? mapProfileUiPreference(result.ui_preference) : undefined;
  const savedPreferences = (result.notification_preferences || []).map(mapNotificationPreference);

  return NextResponse.json({
    profile,
    uiPreference,
    notificationPreferences: savedPreferences,
  });
}
