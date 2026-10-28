import type { Profile } from "@/lib/types";
import type { PlanningReadStatus } from "./planning-state";
import type { ProfileSettingsResult } from "@/features/profile/model/profile-settings-contract";

export type TeamProfilePatch = Partial<Pick<Profile, "platformRole" | "orgRole" | "weeklyCapacity" | "deputyFor" | "deputyActiveFrom" | "deputyActiveUntil">>;
export type TeamProfileSaveView = {
  profileId: string;
  phase: "saving" | "saved" | "rejected" | "unconfirmed" | "conflict";
  submitted: Readonly<TeamProfilePatch> | null;
  error: string;
  status?: number;
  checkStatus?: "checking" | "checked" | "unavailable" | "forbidden";
  followup: "not-needed" | "loading" | "current" | "unavailable" | "partial" | "stale" | "forbidden";
};
export type PlanningTeamView = {
  profiles: readonly Profile[];
  readStatus: PlanningReadStatus;
  completeness: "complete" | "partial" | "none";
  saves: readonly TeamProfileSaveView[];
};
export type TeamProfileResult = ProfileSettingsResult;

export type TeamProfileEditor = {
  view(): { phase: "editing" | "saving" | "saved" | "conflict" | "rejected" | "unconfirmed" | "ended"; current: Profile | null; canResave: boolean; error: string };
  save(patch: TeamProfilePatch): Promise<ProfileSettingsResult>;
  resave(patch: TeamProfilePatch): Promise<ProfileSettingsResult>;
  refreshConflict(): Promise<boolean>;
  close(): void;
};
