import type { NotificationEvent, NotificationDelivery, PlanningHeaderData } from "@/lib/types";
import type { PlanningHeaderSlotKey } from "@/lib/planning-header-data";
import type { PlatformReleaseContent, PlatformReleaseReferenceEntryOutcome, PlatformReleaseReferenceKey, PlatformReleaseReferenceState } from "@/features/platform-releases/model/platform-release-model";
import type { PlanningReadStatus } from "./planning-state";
export type NotificationAction = "seen" | "dismiss";
export type NotificationActionResult = { ok: boolean; phase: "saved" | "rejected" | "unconfirmed" | "session-ended"; error?: string; status?: NotificationEvent["status"] };
export type NotificationOperationView = { eventId?: number; releaseVersion?: string; action: NotificationAction; phase: "saving" | "saved" | "rejected" | "unconfirmed"; error: string; checking: boolean };
export type PlanningHeaderView = { data: PlanningHeaderData; slots: Record<PlanningHeaderSlotKey, { readStatus: PlanningReadStatus; error: string }> };
export type PlanningNotificationsView = { completeness: "complete" | "partial"; events: readonly NotificationEvent[]; deliveries: readonly NotificationDelivery[]; readStatus: PlanningReadStatus; operations: readonly NotificationOperationView[]; continuation: string | null; furtherReadStatus: PlanningReadStatus; references: readonly NotificationInboxReference[]; referenceCoverage: "complete" | "partial" | "unavailable" };
export type PlanningReleasesView = { releases: readonly PlatformReleaseContent[]; readStatus: PlanningReadStatus };
export type NotificationReadReceipt = { readAuthority: import("./planning-server-header-read").PlanningReadAuthority; readActor: { profileId: string; platformRole: import("@/lib/types").Profile["platformRole"] }; sourceRevision: string; observedAt: string; validUntil: string };
export type NotificationSourceObservation = Pick<NotificationReadReceipt, "readAuthority" | "readActor" | "sourceRevision">;
export type NotificationDemand = { inbox: boolean; preview: boolean };
export type NotificationCountReceipt = NotificationReadReceipt & { unreadCount: number };
export type NotificationPreviewReceipt = NotificationReadReceipt & { items: import("@/lib/types").HeaderNotification[] };
export type NotificationInboxReference = { itemId: string; title: string; taskType: "epic" | "initiative" | "deliverable" | "sub_issue" };
export type NotificationInboxReceipt = NotificationReadReceipt & { events: NotificationEvent[]; coverage: "complete" | "partial"; continuation: string | null; references: NotificationInboxReference[]; referenceCoverage: "complete" | "partial" | "unavailable" };
export type NotificationEntryRead = Readonly<{
  id: string;
  session: import("@/lib/credentials/session-types").ServerSessionView;
  readAuthority: import("./planning-server-header-read").PlanningReadAuthority;
  timeoutAt: number;
}>;
export type NotificationEntryResults = {
  inbox: Promise<{ status: "ready"; receipt: NotificationInboxReceipt } | { status: "forbidden" | "unavailable" }>;
  count: Promise<{ status: "ready"; receipt: NotificationCountReceipt } | { status: "forbidden" | "unavailable" }>;
};
export type NotificationEntryOutcome = {
  [Area in keyof NotificationEntryResults]: { area: Area; result: Awaited<NotificationEntryResults[Area]> }
}[keyof NotificationEntryResults];
export type NotificationCountView = { readStatus: PlanningReadStatus; value: number | null };
export interface PlanningNotificationsState {
  acceptNotificationEntry(id: string, outcome: NotificationEntryOutcome): boolean;
  acceptServerHeaderSlot(read: import("./planning-server-header-read").PlanningServerHeaderRead, slot: import("./planning-server-header-read").PlanningServerHeaderSlot, incoming: PlanningHeaderData): boolean;
  header(): PlanningHeaderView;
  refreshHeader(slots?: readonly PlanningHeaderSlotKey[]): Promise<boolean>;
  setNotificationPreviewActive(active: boolean): void;
  setNotificationInboxActive(active: boolean): void;
  notifications(): PlanningNotificationsView;
  refreshNotifications(): Promise<boolean>;
  loadNotificationPage(continuation?: string): Promise<boolean>;
  setNotificationInteraction(active: boolean): void;
  checkNotificationSource(demand: NotificationDemand, signal?: AbortSignal): Promise<void>;
  notificationCount(): NotificationCountView;
  refreshNotificationCount(): Promise<boolean>;
  updateNotificationStatus(eventId: number, action: NotificationAction): Promise<NotificationActionResult>;
  checkNotificationStatus(eventId: number): Promise<boolean>;
  platformReleases(): PlanningReleasesView;
  acceptReleaseReferenceEntry(id: string, outcome: PlatformReleaseReferenceEntryOutcome): boolean;
  cancelReleaseReferenceEntry(id: string): void;
  releasePlanningReferences(key: PlatformReleaseReferenceKey): PlatformReleaseReferenceState;
  loadReleasePlanningReferences(key: PlatformReleaseReferenceKey): Promise<boolean>;
  checkReleasePlanningReferences(key: PlatformReleaseReferenceKey, signal?: AbortSignal): Promise<void>;
  cancelReleasePlanningReferences(key: PlatformReleaseReferenceKey): void;
  loadPlatformReleases(): Promise<boolean>;
  markPlatformReleaseSeen(version: string): Promise<NotificationActionResult>;
  checkPlatformReleaseSeen(version: string): Promise<boolean>;
}
