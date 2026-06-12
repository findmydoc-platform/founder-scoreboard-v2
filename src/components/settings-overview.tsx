"use client";

import { SettingsNotificationsSection } from "@/components/settings-notifications";
import { GitHubSyncQueueSection, ProductionReadinessSection, SetupChecklistSection, SystemStatusSection } from "@/components/settings-readiness";
import { SprintPlanningSection, type SprintPlanningOptions } from "@/components/settings-sprint-planning";
import type { PlanningData, Task } from "@/lib/types";

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
  onReconnectGitHub,
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
  onReconnectGitHub: () => void;
  onSyncLinkedGitHubTasks: () => void;
  onCreateGitHubIssue: (task: Task) => void;
  onSelectFeedback: (id: number) => void;
}) {
  const googleChatReady = Boolean(googleChatStatus?.ready);

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <SystemStatusSection
        source={source}
        authAvailable={authAvailable}
        authUserEmail={authUserEmail}
        githubProviderTokenAvailable={githubProviderTokenAvailable}
        pending={pending}
        googleChatReady={googleChatReady}
        onReconnectGitHub={onReconnectGitHub}
      />
      <ProductionReadinessSection />
      <SetupChecklistSection />
      <GitHubSyncQueueSection
        tasks={data.tasks}
        pending={pending}
        authUserEmail={authUserEmail}
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
