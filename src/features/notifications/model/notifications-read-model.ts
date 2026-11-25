import type { HeaderNotification, NotificationDelivery, NotificationEvent, PlatformRole, Profile, Task } from "@/lib/types";

export type NotificationsWorkspaceModel = Readonly<{
  revision: string;
  readCoverage?: Readonly<Partial<Record<"people" | "items" | "strategies" | "raci" | "links", "complete" | "partial">>>;
  coverage?: { events: "complete" | "partial"; deliveries: "complete" | "partial" | "forbidden" };
  people: readonly Profile[];
  items: readonly Task[];
  events: readonly NotificationEvent[];
  deliveries: readonly NotificationDelivery[];
}>;

export type NotificationsLoadResult = { status: "ready"; model: NotificationsWorkspaceModel } | { status: "forbidden" } | { status: "unavailable" };

export type NotificationInboxPosition = { createdAt: string; id: number };
export type NotificationInboxReference = { itemId: string; title: string; taskType: "epic" | "initiative" | "deliverable" | "sub_issue" };

export interface NotificationsReadModel {
  load(context: { authorized: boolean; actorProfileId: string | null }): Promise<NotificationsLoadResult>;
  loadPreview(context: { authorized: boolean; actorProfileId: string | null; platformRole: PlatformRole | null; signal?: AbortSignal }): Promise<{ status: "ready"; items: HeaderNotification[] } | { status: "forbidden" | "unavailable" }>;
  loadUnreadCount(context: { authorized: boolean; actorProfileId: string | null; platformRole: PlatformRole | null; signal?: AbortSignal }): Promise<{ status: "ready"; unreadCount: number } | { status: "forbidden" | "unavailable" }>;
  loadInbox(context: { authorized: boolean; actorProfileId: string | null; platformRole: PlatformRole | null; signal?: AbortSignal; limit: number; position?: NotificationInboxPosition }): Promise<{ status: "ready"; events: NotificationEvent[]; coverage: "complete" | "partial"; next: NotificationInboxPosition | null; references: NotificationInboxReference[]; referenceCoverage: "complete" | "partial" | "unavailable" } | { status: "forbidden" | "unavailable" }>;
}
