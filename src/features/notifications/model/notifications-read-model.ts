import type { NotificationDelivery, NotificationEvent, Profile, Task } from "@/lib/types";

export type NotificationsWorkspaceModel = Readonly<{
  revision: string;
  people: readonly Profile[];
  items: readonly Task[];
  events: readonly NotificationEvent[];
  deliveries: readonly NotificationDelivery[];
}>;

export type NotificationsLoadResult = { status: "ready"; model: NotificationsWorkspaceModel } | { status: "forbidden" } | { status: "unavailable" };

export interface NotificationsReadModel {
  load(context: { authorized: boolean; actorProfileId: string | null }): Promise<NotificationsLoadResult>;
}
