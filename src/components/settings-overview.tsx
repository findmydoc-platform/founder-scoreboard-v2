"use client";

import { SettingsNotificationsSection } from "@/components/settings-notifications";
import { GitHubSyncQueueSection, ProductionReadinessSection, SetupChecklistSection, SystemStatusSection } from "@/components/settings-readiness";
import { SprintPlanningSection, type SprintPlanningOptions } from "@/components/settings-sprint-planning";
import type { NotificationDelivery, PlanningData, Task } from "@/lib/types";

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
  githubProviderTokenAvailable,
  pending,
  feedbackMessage,
  selectedFeedbackId,
  notificationDispatchMessage,
  googleChatStatus,
  sprintPlanningOptions,
  plannedSprintCount,
  onUpdateSprintPlanning,
  onCreateSprintPlan,
  onDispatchNotifications,
  onRetryNotificationDelivery,
  onSendGoogleChatTest,
  onSyncLinkedGitHubTasks,
  onCreateGitHubIssue,
  onSelectFeedback,
}: {
  data: PlanningData;
  source: "seed" | "supabase";
  authAvailable: boolean;
  authUserEmail: string;
  githubProviderTokenAvailable: boolean;
  pending: boolean;
  feedbackMessage: string;
  selectedFeedbackId: number | null;
  notificationDispatchMessage: string;
  googleChatStatus: GoogleChatStatusSummary | null;
  sprintPlanningOptions: SprintPlanningOptions;
  plannedSprintCount: number;
  onUpdateSprintPlanning: (options: SprintPlanningOptions) => void;
  onCreateSprintPlan: (options: SprintPlanningOptions) => void;
  onDispatchNotifications: () => void;
  onRetryNotificationDelivery: (delivery: NotificationDelivery) => void;
  onSendGoogleChatTest: (testDelivery: "webhook_digest" | "direct_dm", profileId?: string) => void;
  onSyncLinkedGitHubTasks: () => void;
  onCreateGitHubIssue: (task: Task) => void;
  onSelectFeedback: (id: number) => void;
}) {
  const googleChatReady = Boolean(googleChatStatus?.ready);

  return (
    <div className="grid grid-cols-1 min-w-0 gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <SystemStatusSection
        source={source}
        authAvailable={authAvailable}
        authUserEmail={authUserEmail}
        githubProviderTokenAvailable={githubProviderTokenAvailable}
        googleChatReady={googleChatReady}
      />
      <ProductionReadinessSection />
      <SetupChecklistSection />
      <GitHubSyncQueueSection
        tasks={data.tasks}
        pending={pending}
        githubProviderTokenAvailable={githubProviderTokenAvailable}
        onSyncLinkedGitHubTasks={onSyncLinkedGitHubTasks}
        onCreateGitHubIssue={onCreateGitHubIssue}
      />
      <SettingsNotificationsSection
        data={data}
        pending={pending}
        feedbackMessage={feedbackMessage}
        selectedFeedbackId={selectedFeedbackId}
        notificationDispatchMessage={notificationDispatchMessage}
        googleChatStatus={googleChatStatus}
        onSelectFeedback={onSelectFeedback}
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
