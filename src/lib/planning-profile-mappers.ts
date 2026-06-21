import type { Milestone, Package, Profile } from "./types";
import type { DbMilestone, DbPackage, DbProfile } from "./planning-data-row-types";

const fallbackProfileColors: Record<string, string> = {
  volkan: "#22c55e",
  sebastian: "#3b82f6",
  anil: "#f59e0b",
  ozen: "#8b5cf6",
  youssef: "#ec4899",
};

function profileColor(id: string, value?: string | null) {
  return value || fallbackProfileColors[id] || "#64748b";
}

export function mapProfile(row: DbProfile): Profile {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    platformRole: row.platform_role || (row.role === "admin" ? "ceo" : "founder"),
    orgRole: row.org_role || (row.role === "admin" ? "CEO" : "Founder"),
    githubLogin: row.github_login || "",
    deputyFor: row.deputy_for || "",
    deputyActiveFrom: row.deputy_active_from || "",
    deputyActiveUntil: row.deputy_active_until || "",
    focus: row.focus || "",
    weeklyCapacity: row.weekly_capacity,
    color: profileColor(row.id, row.profile_color),
    googleChatUserId: row.google_chat_user_id || "",
    googleChatDmSpace: row.google_chat_dm_space || "",
    notificationsEnabled: row.notifications_enabled !== false,
    googleCalendarEmail: row.google_calendar_email || "",
    googleCalendarSyncEnabled: Boolean(row.google_calendar_sync_enabled),
    googleCalendarLastSyncedAt: row.google_calendar_last_synced_at || "",
  };
}

export function mapPackage(row: DbPackage): Package {
  const ownerId = row.owner_id || "";
  return {
    id: row.id,
    milestoneId: row.milestone_id || "",
    ownerId,
    accountableProfileId: row.accountable_profile_id || ownerId,
    responsibleProfileIds: row.responsible_profile_ids?.length ? row.responsible_profile_ids : ownerId ? [ownerId] : [],
    consultedProfileIds: row.consulted_profile_ids || [],
    informedProfileIds: row.informed_profile_ids || [],
    title: row.title,
    goal: row.goal || "",
    priority: row.priority || "P2",
    status: row.status || "planned",
    targetDate: row.target_date || "",
    successCriteria: row.success_criteria || "",
    scopeConstraints: row.scope_constraints || "",
    sortOrder: row.sort_order,
  };
}

export function mapMilestone(row: DbMilestone): Milestone {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    targetDate: row.target_date || "",
    status: row.status,
    sortOrder: row.sort_order,
  };
}

export function profileNameById(profiles: Profile[], profileId?: string | null) {
  return profiles.find((profile) => profile.id === profileId)?.name || profileId || "";
}
