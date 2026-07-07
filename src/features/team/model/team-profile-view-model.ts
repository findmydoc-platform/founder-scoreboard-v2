import { formatDate } from "@/lib/display";
import { taskBelongsToProfile } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { PlatformRole, Profile, Task } from "@/lib/types";

export const platformRoleOptions: PlatformRole[] = ["ceo", "founder", "deputy", "viewer"];

export const profileDraftFields: Array<keyof Profile> = [
  "platformRole",
  "orgRole",
  "githubLogin",
  "weeklyCapacity",
  "deputyFor",
  "deputyActiveFrom",
  "deputyActiveUntil",
];

export type TeamProfileDraft = Partial<Pick<Profile, (typeof profileDraftFields)[number]>>;

export type TeamMemberStats = {
  highPriorityTasks: number;
  loadHours: number;
  openTasks: number;
};

export function roleOptionLabel(role: PlatformRole) {
  if (role === "ceo") return "CEO";
  if (role === "founder") return "Founder";
  if (role === "deputy") return "Deputy";
  return "Viewer";
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

export function profileHasDraftChanges(profile: Profile, draft?: TeamProfileDraft) {
  if (!draft) return false;
  return profileDraftFields.some((field) => field in draft && !sameProfileValue(draft[field], profile[field]));
}

export function teamMemberStats(tasks: Task[], profile: Profile): TeamMemberStats {
  const ownedTasks = tasks.filter((task) => taskBelongsToProfile(task, profile));
  const openTasks = ownedTasks.filter((task) => normalizeStatus(task.status) !== "Erledigt");
  return {
    highPriorityTasks: openTasks.filter((task) => ["P0", "P1"].includes(task.priority)).length,
    loadHours: ownedTasks.reduce((sum, task) => sum + task.hours, 0),
    openTasks: openTasks.length,
  };
}

export function deputyLabel(profile: Profile, profiles: Profile[]) {
  if (profile.platformRole !== "deputy" || !profile.deputyFor) return "";
  const represented = profiles.find((item) => item.id === profile.deputyFor);
  const representedName = represented?.name || profile.deputyFor;
  return profile.deputyActiveUntil ? `Vertritt ${representedName} bis ${formatDate(profile.deputyActiveUntil)}` : `Vertritt ${representedName}`;
}
