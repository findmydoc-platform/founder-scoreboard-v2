import type { TeamWorkweekWindows } from "./team-workweek-draft";

export type PublishedTeamWorkweek = Readonly<{
  id: string;
  ownerProfileId: string;
  effectiveFrom: string;
  timezone: "Europe/Berlin";
  publishedAt: string;
  lastSyncAt: string;
  windows: TeamWorkweekWindows;
}>;
