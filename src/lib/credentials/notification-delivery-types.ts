import type { NextRequest } from "next/server";
import type { GoogleChatDigestEvent } from "../google-chat";
export type NotificationDeliveryRow = {
  id: number;
  type: string;
  actor_profile_id: string | null;
  recipient_profile_id: string | null;
  entity_type: string;
  entity_id: string;
  title: string;
  body: string | null;
  created_at: string;
};
export type NotificationDeliveryProfile = {
  id: string;
  name: string;
  google_chat_user_id: string | null;
  google_chat_dm_space: string | null;
  notifications_enabled: boolean | null;
};
export type NotificationDeliveryPreference = {
  profile_id: string;
  event_type: string;
  enabled: boolean;
};
export type DeliveryRecordRow = {
  row: NotificationDeliveryRow;
  target: string;
  payload: GoogleChatDigestEvent;
};
export type DeliverySelection = {
  limit?: unknown;
  eventIds?: unknown;
  testDelivery?: unknown;
  profileId?: unknown;
};
export type NotificationDeliveryInput = {
  credential: {
    kind: "notification-delivery-request";
    request: NextRequest;
  };
  action: "notifications.delivery.inspect";
} | {
  credential: {
    kind: "notification-delivery-request";
    request: NextRequest;
  };
  action: "notifications.delivery.run";
  selection: DeliverySelection;
};
export type NotificationDeliveryResult = Awaited<ReturnType<typeof import("./internal/notification-delivery").authorizeNotificationDelivery>>;
export type NotificationDigestInput = {
  credential: {
    kind: "notification-delivery-request";
    request: NextRequest;
  };
  action: "notifications.digest.generate";
  limit?: unknown;
  dryRun: boolean;
};
export type NotificationDigestResult = Awaited<ReturnType<typeof import("./internal/notification-digest").authorizeNotificationDigest>>;
export type GitHubReconciliationInput = {
  credential: {
    kind: "notification-delivery-request";
    request: NextRequest;
  };
  action: "github.reconciliation.preview" | "github.reconciliation.deliver";
};
export type GitHubReconciliationResult = Awaited<ReturnType<typeof import("./internal/delivery-reconciliation").authorizeDeliveryReconciliation>>;
