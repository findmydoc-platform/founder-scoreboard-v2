import type { PublishedTeamWorkweek } from "./published-team-workweek";
import type { Profile } from "@/lib/types";

export type TeamWorkweekMatrixRow = Readonly<{
  profile: Profile;
  workweek: PublishedTeamWorkweek | null;
}>;

export function starterTeamProfiles(profiles: Profile[]) {
  return profiles
    .filter((profile) => profile.platformRole === "ceo" || profile.platformRole === "founder")
    .sort((left, right) => Number(right.platformRole === "ceo") - Number(left.platformRole === "ceo"));
}

export function isTeamWorkweekStarterProfile(profiles: Profile[], profile: Profile | null | undefined) {
  if (!profile) return false;
  const starterProfiles = starterTeamProfiles(profiles);
  return starterProfiles.length === 5 && starterProfiles.some((candidate) => candidate.id === profile.id);
}

export function projectActiveTeamWorkweekRows(
  profiles: Profile[],
  workweeks: PublishedTeamWorkweek[],
): TeamWorkweekMatrixRow[] {
  const currentByOwner = new Map<string, PublishedTeamWorkweek>();
  for (const workweek of workweeks) {
    if (workweek.phase !== "current" || currentByOwner.has(workweek.ownerProfileId)) continue;
    currentByOwner.set(workweek.ownerProfileId, workweek);
  }
  return starterTeamProfiles(profiles).map((profile) => ({
    profile,
    workweek: currentByOwner.get(profile.id) || null,
  }));
}
