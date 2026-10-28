import type { NotificationPreference, Profile, ProfileFeatureTourAcknowledgement, ProfileUiPreference } from "@/lib/types";
import type { PlanningReadStatus } from "@/features/planning/model/planning-state";

export type OwnProfileSettingsExpected = {
  profile: Record<string, unknown>;
  ui?: import("@/lib/types").ProfileUiPersistenceBasis | null;
  events: Record<string, boolean | null>;
};
export type OwnProfileSettingsPatch = {
  expected?: OwnProfileSettingsExpected;
  profilePatch?: Partial<Pick<Profile, "focus" | "color" | "notificationsEnabled">>;
  profileColorDuplicateMode?: boolean;
  notificationEvents?: Record<string, boolean>;
  uiPreferences?: Pick<ProfileUiPreference, "defaultWorkspace" | "defaultTaskView" | "planningFilters" | "expandedInitiativeIds">;
};
export type OwnProfileSettingsConfirmation = { profile: Profile; uiPreference?: ProfileUiPreference; notificationPreferences: NotificationPreference[] };
export type ProfileSettingsSaveView = {
  phase: "saved" | "saving" | "rejected" | "unconfirmed" | "conflict";
  submitted: Readonly<OwnProfileSettingsPatch> | null;
  error: string;
  checkStatus?: "checking" | "checked" | "unavailable" | "forbidden";
};
export type ProfileSettingsView = {
  profile: Profile | null;
  uiPreference: ProfileUiPreference | null;
  notificationPreferences: readonly NotificationPreference[];
  acknowledgements: readonly ProfileFeatureTourAcknowledgement[];
  tourSaves: readonly { tourId: string; phase: "saving" | "saved" | "rejected" | "unconfirmed"; error: string }[];
  readStatus: PlanningReadStatus;
  save: ProfileSettingsSaveView;
};
export type ProfileSettingsResult = { ok: true } | { ok: false; kind: "rejected" | "unconfirmed" | "sessionSuperseded" | "versionConflict"; error: string; code?: string; status?: number };

export type OwnProfileEditingSnapshot = { profile: Profile; uiPreference: ProfileUiPreference | null; notificationPreferences: readonly NotificationPreference[] };
export type OwnProfileEditor = {
  view(): { phase: "editing" | "saving" | "saved" | "conflict" | "rejected" | "unconfirmed" | "ended"; current: OwnProfileEditingSnapshot | null; canResave: boolean; error: string };
  save(patch: OwnProfileSettingsPatch): Promise<ProfileSettingsResult>;
  resave(patch: OwnProfileSettingsPatch): Promise<ProfileSettingsResult>;
  refreshConflict(): Promise<boolean>;
  close(): void;
};
