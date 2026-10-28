import type { NotificationPreference, Profile, ProfileUiPreference, Project, Task } from "@/lib/types";

export type ProfileWorkspaceModel = Readonly<{
  revision: string;
  readCoverage?: Readonly<Partial<Record<"project" | "people" | "initiatives" | "strategies" | "raci" | "links" | "notificationPreferences" | "preferences", "complete" | "partial">>>;
  project: Project;
  people: readonly Profile[];
  initiatives: readonly Task[];
  notificationPreferences: readonly NotificationPreference[];
  preferences: readonly ProfileUiPreference[];
}>;

export type ProfileLoadResult = { status: "ready"; model: ProfileWorkspaceModel } | { status: "forbidden" } | { status: "unavailable" };

export interface ProfileReadModel {
  load(context: { authorized: boolean; actorProfileId: string | null }): Promise<ProfileLoadResult>;
}
