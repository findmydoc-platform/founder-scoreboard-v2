"use client";

import { SettingsNotificationsSection } from "@/features/settings/organisms/settings-notifications";
import type { NotificationDelivery, PlanningData } from "@/lib/types";

type GoogleChatStatusSummary = {
  webhookConfigured: boolean;
  apiConfigured: boolean;
  deliveryEnabled: boolean;
  ready: boolean;
  mode: "direct-dm" | "space-webhook" | "not-configured";
};

export function SettingsOverview({
  data,
  pending,
  notificationDispatchMessage,
  googleChatStatus,
  onDispatchNotifications,
  onRetryNotificationDelivery,
  onSendGoogleChatTest,
}: {
  data: PlanningData;
  pending: boolean;
  notificationDispatchMessage: string;
  googleChatStatus: GoogleChatStatusSummary | null;
  onDispatchNotifications: () => void;
  onRetryNotificationDelivery: (delivery: NotificationDelivery) => void;
  onSendGoogleChatTest: (testDelivery: "webhook_digest" | "direct_dm", profileId?: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 min-w-0 gap-4">
      <SettingsNotificationsSection
        data={data}
        pending={pending}
        notificationDispatchMessage={notificationDispatchMessage}
        googleChatStatus={googleChatStatus}
        onDispatchNotifications={onDispatchNotifications}
        onRetryNotificationDelivery={onRetryNotificationDelivery}
        onSendGoogleChatTest={onSendGoogleChatTest}
      />
    </div>
  );
}
