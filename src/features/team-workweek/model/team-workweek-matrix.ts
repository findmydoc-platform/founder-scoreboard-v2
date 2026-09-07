import {
  projectCurrentCalendarWorkweekRows,
  type CalendarTeamWorkweek,
} from "./team-workweek-calendar";
import type { Profile } from "@/lib/types";

export type TeamWorkweekMatrixRow = Readonly<{
  profile: Profile;
  workweek: CalendarTeamWorkweek | null;
}>;

export function teamWorkweekProfiles(profiles: Profile[]) {
  return [...profiles]
    .sort((left, right) => Number(right.platformRole === "ceo") - Number(left.platformRole === "ceo"));
}

export function projectActiveTeamWorkweekRows(
  profiles: Profile[],
  workweeks: CalendarTeamWorkweek[],
  dateKey: string,
): TeamWorkweekMatrixRow[] {
  return projectCurrentCalendarWorkweekRows({
    calendarWorkweeks: workweeks,
    dateKey,
    profiles: teamWorkweekProfiles(profiles),
  });
}
