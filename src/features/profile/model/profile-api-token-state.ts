import type { TeamPlanningItemTokenRecord } from "@/features/planning-items/model/planning-items-contract";
import type { PlanningReadStatus } from "@/features/planning/model/planning-state";
import type { ProfileSettingsResult } from "./profile-settings-contract";

export type ProfileApiTokenDraft = { label: string; allowUpdates: boolean; allowEmptyEpicDeletes: boolean; allowGitHubSync: boolean };
export type ProfileApiTokenOperation = { action: "issue" | "revoke"; tokenId?: string; submitted?: Readonly<ProfileApiTokenDraft>; phase: "saving" | "saved" | "rejected" | "unconfirmed"; error: string };
export type ProfileApiTokensView = {
  tokens: readonly TeamPlanningItemTokenRecord[];
  canIssueEmptyEpicDeletes: boolean;
  readStatus: PlanningReadStatus;
  operations: readonly ProfileApiTokenOperation[];
};
export type ProfileApiTokenIssueResult = { ok: true; token: string } | Exclude<ProfileSettingsResult, { ok: true }>;
export type ProfileApiTokenAdapter = {
  readProfileApiTokens?: () => Promise<{ tokens: TeamPlanningItemTokenRecord[]; canIssueEmptyEpicDeletes: boolean }>;
  issueProfileApiToken?: (draft: ProfileApiTokenDraft) => Promise<{ token: string; tokenRecord: TeamPlanningItemTokenRecord }>;
  revokeProfileApiToken?: (tokenId: string) => Promise<void>;
};
