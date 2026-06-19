import { googleChatDigestEventTypes } from "@/lib/notification-policy";
import type { PlanningData, PlatformRole, Profile } from "@/lib/types";

export const platformRoleOptions: PlatformRole[] = ["ceo", "founder", "deputy", "viewer"];

export const profileColorOptions = [
  { value: "#22c55e", label: "Mint" },
  { value: "#3b82f6", label: "Blau" },
  { value: "#f59e0b", label: "Gelb" },
  { value: "#8b5cf6", label: "Lila" },
  { value: "#ec4899", label: "Pink" },
  { value: "#14b8a6", label: "Türkis" },
  { value: "#ef4444", label: "Rot" },
  { value: "#64748b", label: "Schiefer" },
];

export const profileDraftFields: Array<keyof Profile> = [
  "platformRole",
  "orgRole",
  "githubLogin",
  "googleChatUserId",
  "googleChatDmSpace",
  "notificationsEnabled",
  "googleCalendarSyncEnabled",
  "googleCalendarEmail",
  "focus",
  "color",
  "weeklyCapacity",
  "deputyFor",
  "deputyActiveFrom",
  "deputyActiveUntil",
];

export type ProfileCardDraft = {
  profile: Partial<Profile>;
  notificationEvents: Record<string, boolean>;
};

export function profileColor(profile?: Pick<Profile, "color"> | null) {
  return profile?.color || "#64748b";
}

export function eventEnabled(data: PlanningData, profileId: string, eventType: string) {
  const preference = data.notificationPreferences.find((item) => item.profileId === profileId && item.channel === "google_chat" && item.eventType === eventType);
  return preference?.enabled !== false;
}

export function sameProfileValue(left: unknown, right: unknown) {
  return (left ?? "") === (right ?? "");
}

export function activeDeputyProfiles(profiles: Profile[], today: string) {
  return profiles.filter((profile) => {
    if (profile.platformRole !== "deputy") return false;
    if (profile.deputyActiveFrom && profile.deputyActiveFrom > today) return false;
    if (profile.deputyActiveUntil && profile.deputyActiveUntil < today) return false;
    return Boolean(profile.deputyFor);
  });
}

export function profileHasDraftChanges(data: PlanningData, profile: Profile, draft?: ProfileCardDraft) {
  if (!draft) return false;
  const profileDirty = profileDraftFields.some((field) => field in draft.profile && !sameProfileValue(draft.profile[field], profile[field]));
  const eventsDirty = googleChatDigestEventTypes.some((eventType) =>
    eventType in draft.notificationEvents && draft.notificationEvents[eventType] !== eventEnabled(data, profile.id, eventType)
  );
  return profileDirty || eventsDirty;
}
