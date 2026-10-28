import type { NotificationPreference, Profile, ProfileFeatureTourAcknowledgement, ProfileUiPreference } from "@/lib/types";
import type { PlanningReadStatus } from "@/features/planning/model/planning-state";

export type OwnProfileSettingsPatch = {
  profilePatch?: Partial<Pick<Profile, "focus" | "color" | "notificationsEnabled">>;
  profileColorDuplicateMode?: boolean;
  notificationEvents?: Record<string, boolean>;
  uiPreferences?: Pick<ProfileUiPreference, "defaultWorkspace" | "defaultTaskView" | "planningFilters" | "expandedInitiativeIds">;
};
export type OwnProfileSettingsConfirmation = { profile: Profile; uiPreference?: ProfileUiPreference; notificationPreferences: NotificationPreference[] };
export type ProfileSettingsSaveView = {
  phase: "saved" | "saving" | "rejected" | "unconfirmed";
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
export type ProfileSettingsResult = { ok: true } | { ok: false; kind: "rejected" | "unconfirmed" | "sessionSuperseded"; error: string; code?: string; status?: number };
