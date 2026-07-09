"use client";

import { SettingsNotificationsSection } from "@/features/settings/organisms/settings-notifications";
import { SystemStatusSection } from "@/features/settings/organisms/settings-readiness";
import { SprintPlanningSection, type SprintPlanningOptions } from "@/features/settings/molecules/settings-sprint-planning";
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
  source,
  authAvailable,
  authUserEmail,
  githubAppConnected,
  pending,
  notificationDispatchMessage,
  googleChatStatus,
  sprintPlanningOptions,
  plannedSprintCount,
  onUpdateSprintPlanning,
  onCreateSprintPlan,
  onDispatchNotifications,
  onRetryNotificationDelivery,
  onSendGoogleChatTest,
}: {
  data: PlanningData;
  source: "seed" | "supabase";
  authAvailable: boolean;
  authUserEmail: string;
  githubAppConnected: boolean;
  pending: boolean;
  notificationDispatchMessage: string;
  googleChatStatus: GoogleChatStatusSummary | null;
  sprintPlanningOptions: SprintPlanningOptions;
  plannedSprintCount: number;
  onUpdateSprintPlanning: (options: SprintPlanningOptions) => void;
  onCreateSprintPlan: (options: SprintPlanningOptions) => void;
  onDispatchNotifications: () => void;
  onRetryNotificationDelivery: (delivery: NotificationDelivery) => void;
  onSendGoogleChatTest: (testDelivery: "webhook_digest" | "direct_dm", profileId?: string) => void;
}) {
  const googleChatReady = Boolean(googleChatStatus?.ready);

  return (
    <div className="grid grid-cols-1 min-w-0 gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <SystemStatusSection
        source={source}
        authAvailable={authAvailable}
        authUserEmail={authUserEmail}
        githubAppConnected={githubAppConnected}
        googleChatReady={googleChatReady}
      />
      <SettingsNotificationsSection
        data={data}
        pending={pending}
        notificationDispatchMessage={notificationDispatchMessage}
        googleChatStatus={googleChatStatus}
        onDispatchNotifications={onDispatchNotifications}
        onRetryNotificationDelivery={onRetryNotificationDelivery}
        onSendGoogleChatTest={onSendGoogleChatTest}
      />
      <SprintPlanningSection
        pending={pending}
        sprintPlanningOptions={sprintPlanningOptions}
        plannedSprintCount={plannedSprintCount}
        onUpdateSprintPlanning={onUpdateSprintPlanning}
        onCreateSprintPlan={onCreateSprintPlan}
      />
    </div>
  );
}
