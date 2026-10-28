import type { NotificationEvent, NotificationDelivery, PlanningHeaderData } from "@/lib/types";
import type { PlanningHeaderSlotKey } from "@/lib/planning-header-data";
import type { PlatformReleaseRecord } from "@/features/platform-releases/model/platform-release-model";
import type { PlanningReadStatus } from "./planning-state";
export type NotificationAction = "seen" | "dismiss";
export type NotificationActionResult = { ok: boolean; phase: "saved" | "rejected" | "unconfirmed" | "session-ended"; error?: string; status?: NotificationEvent["status"] };
export type NotificationOperationView = { eventId?: number; releaseVersion?: string; action: NotificationAction; phase: "saving" | "saved" | "rejected" | "unconfirmed"; error: string; checking: boolean };
export type PlanningHeaderView = { data: PlanningHeaderData; slots: Record<PlanningHeaderSlotKey, { readStatus: PlanningReadStatus; error: string }> };
export type PlanningNotificationsView = { completeness: "complete" | "partial"; events: readonly NotificationEvent[]; deliveries: readonly NotificationDelivery[]; readStatus: PlanningReadStatus; operations: readonly NotificationOperationView[] };
export type PlanningReleasesView = { releases: readonly PlatformReleaseRecord[]; readStatus: PlanningReadStatus };
export interface PlanningNotificationsState {
  header(): PlanningHeaderView;
  refreshHeader(slots?: readonly PlanningHeaderSlotKey[]): Promise<boolean>;
  notifications(): PlanningNotificationsView;
  refreshNotifications(): Promise<boolean>;
  updateNotificationStatus(eventId: number, action: NotificationAction): Promise<NotificationActionResult>;
  checkNotificationStatus(eventId: number): Promise<boolean>;
  platformReleases(): PlanningReleasesView;
  loadPlatformReleases(): Promise<boolean>;
  markPlatformReleaseSeen(version: string): Promise<NotificationActionResult>;
  checkPlatformReleaseSeen(version: string): Promise<boolean>;
}
