import type { NextRequest } from "next/server";

export type AccountCredentialInput = ({
  credential: { kind: "session-request"; request: NextRequest };
} & (
  | { action: "account.settings.update" | "account.github-project.update" | "account.notifications.update" | "account.tour.acknowledge" | "account.preview.write" | "account.profile.read" | "releases.read" }
  | { action: "account.governance.update"; targetProfileId: string }
  | { action: "releases.seen"; version: string }
)) | { credential: { kind: "server-cookies" }; action: "account.preview.read"; path: string }
  | { credential: { kind: "server-cookies" }; action: "account.profile.read" | "releases.read" };

export type AccountSettingsUpdate = {
  profilePatch: { focus?: string | null; profile_color?: string; profile_color_duplicate_mode?: boolean; notifications_enabled?: boolean };
  uiPreferences: Record<string, unknown> | null;
  notificationEvents: Record<string, boolean>;
  metadata: { request_ip?: string | null; user_agent?: string | null };
};

export type AccountCredentialResult = Awaited<ReturnType<typeof import("./internal/account").authorizeAccount>>;

export type AccountGitHubProjectUpdate = {
  expectedOwner: string; expectedNumber: number; expectedTeamSlug: string;
  owner: string; number: number; teamSlug: string;
  metadata: { request_ip?: string | null; user_agent?: string | null };
};

export type AccountNotificationPreferenceUpdate = {
  profileId: string; eventType: string; enabled: boolean;
  metadata: { request_ip?: string | null; user_agent?: string | null };
};

export type AccountPreviewUpload = { bytes: Uint8Array; contentType: string };
