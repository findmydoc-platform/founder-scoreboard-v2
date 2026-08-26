import type { PublishedTeamWorkweek } from "./published-team-workweek";
import type { Profile } from "@/lib/types";

export type TeamWorkweekMatrixRow = Readonly<{
  profile: Profile;
  workweek: PublishedTeamWorkweek | null;
}>;

export function starterTeamProfiles(profiles: Profile[]) {
  return profiles.filter((profile) => profile.platformRole === "ceo" || profile.platformRole === "founder");
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
