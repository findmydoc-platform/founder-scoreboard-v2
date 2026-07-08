"use client";

import dynamic from "next/dynamic";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { futureSprintDrafts, sortTasks } from "@/features/planning/model/planning-app-model";
import { PlanningTaskViewRenderer } from "@/features/planning/organisms/planning-task-view-renderer";
import { TaskGitHubSyncQueue } from "@/features/tasks/organisms/task-github-sync-queue";
import { UiPanel } from "@/shared/atoms/ui-primitives";

const CeoTaskIntake = dynamic(() => import("@/features/intake/organisms/ceo-task-intake").then((mod) => mod.CeoTaskIntake), { loading: WorkspacePanelLoading });
const EventsOverview = dynamic(() => import("@/features/events/organisms/events-overview").then((mod) => mod.EventsOverview), { loading: WorkspacePanelLoading });
const ProjectsOverview = dynamic(() => import("@/features/projects/organisms/projects-overview").then((mod) => mod.ProjectsOverview), { loading: WorkspacePanelLoading });
const ProfileSettingsOverview = dynamic(() => import("@/features/profile/organisms/profile-settings-overview").then((mod) => mod.ProfileSettingsOverview), { loading: WorkspacePanelLoading });
const ReviewWorkspaceOverview = dynamic(() => import("@/features/reviews/organisms/review-workspace-overview").then((mod) => mod.ReviewWorkspaceOverview), { loading: WorkspacePanelLoading });
const SettingsOverview = dynamic(() => import("@/features/settings/organisms/settings-overview").then((mod) => mod.SettingsOverview), { loading: WorkspacePanelLoading });
const SprintScoreTableOverview = dynamic(() => import("@/features/sprint/organisms/sprint-score-overview").then((mod) => mod.SprintScoreTableOverview), { loading: WorkspacePanelLoading });
const FmdToolsOverview = dynamic(() => import("@/features/tools/organisms/fmd-tools-overview").then((mod) => mod.FmdToolsOverview), { loading: WorkspacePanelLoading });
const TeamOverview = dynamic(() => import("@/features/team/organisms/team-overview").then((mod) => mod.TeamOverview), { loading: WorkspacePanelLoading });

type PlanningWorkspaceRendererProps = {
  controller: PlanningAppController;
  source: "seed" | "supabase";
};

function WorkspacePanelLoading() {
  return (
    <UiPanel padding="xl" className="grid min-h-72 gap-4">
      <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="rounded-md border border-slate-100 bg-slate-50 p-4">
            <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
            <div className="mt-5 h-8 w-16 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="h-32 animate-pulse rounded-md bg-slate-100" />
    </UiPanel>
  );
}

export function PlanningWorkspaceRenderer({ controller, source }: PlanningWorkspaceRendererProps) {
  const {
    canManageTaskMeta,
    canUseCeoIntake,
    createFounderEvent,
    createScoreObjection,
    createSprintPlan,
    currentProfile,
    data,
    dispatchNotifications,
    eventMessage,
    expandedPackages,
    feedbackMessage,
    filters,
    focusedReviewTaskId,
    googleChatStatus,
    githubAppConnected,
    githubSyncQueueOpen,
    isPending,
    lockSprint,
    notificationDispatchMessage,
    openTaskPanel,
    reopenReviewTask,
    apiClient,
    retryNotificationDelivery,
    reviewOwnerFilter,
    reviewScoreObjection,
    reviewStatusFilter,
    reviewTask,
    saveProfileSettings,
    saveOwnProfileSettings,
    selectedFeedbackId,
    sendGoogleChatTest,
    setData,
    setFocusedReviewTaskId,
    setGithubSyncQueueOpen,
    setInitiativeDialogDefaults,
    setReviewOwnerFilter,
    setReviewStatusFilter,
    setSelectedFeedbackId,
    setSprintPlanningOptions,
    sprintLockMessage,
    sprintPlanningOptions,
    syncLinkedGitHubTasks,
    syncTaskToGitHub,
    updateFounderEvent,
    updateMeetingAttendance,
    updateSprint,
    updateSprintCommitment,
    updateTask,
    view,
    workspace,
  } = controller;

  return (
    <section className="min-w-0 px-4 pb-8 pt-4 lg:px-6">
      {workspace === "ceo-intake" && canUseCeoIntake && (
        <CeoTaskIntake
          source={source}
          profiles={data.profiles}
          packages={data.packages}
          sprints={data.sprints}
          apiClient={apiClient}
          onTasksCreated={(tasks) => {
            setData((current) => ({
              ...current,
              tasks: sortTasks([...current.tasks, ...tasks]),
            }));
          }}
        />
      )}
      {workspace === "ceo-intake" && !canUseCeoIntake && (
        <UiPanel padding="xl">
          <h2 className="text-lg font-semibold text-slate-950">CEO Intake ist geschützt</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Dieser Bereich ist ausschließlich für die CEO-Rolle freigeschaltet. Deputy, Founder, Accountable, Responsible und Zuständige haben hier keinen Zugriff.
          </p>
        </UiPanel>
      )}
      {workspace === "projects" && (
        <ProjectsOverview
          data={data}
          tasks={data.tasks}
          currentProfile={currentProfile}
          canManageInitiatives={canManageTaskMeta}
          onEditInitiative={(initiative) => setInitiativeDialogDefaults({
            id: initiative.id,
            title: initiative.title,
            milestoneId: initiative.milestoneId || "",
            ownerId: initiative.ownerId || "",
            accountableProfileId: initiative.accountableProfileId || initiative.ownerId || "",
            responsibleProfileIds: initiative.responsibleProfileIds?.length ? initiative.responsibleProfileIds : initiative.ownerId ? [initiative.ownerId] : [],
            consultedProfileIds: initiative.consultedProfileIds || [],
            informedProfileIds: initiative.informedProfileIds || [],
            priority: initiative.priority,
            status: initiative.status || "planned",
            targetDate: initiative.targetDate || "",
            goal: initiative.goal,
            successCriteria: initiative.successCriteria || "",
            scopeConstraints: initiative.scopeConstraints || "",
          })}
        />
      )}
      {workspace === "reviews" && (
        <ReviewWorkspaceOverview
          data={data}
          currentProfile={currentProfile}
          statusFilter={reviewStatusFilter}
          ownerFilter={reviewOwnerFilter}
          onStatusFilterChange={setReviewStatusFilter}
          onOwnerFilterChange={setReviewOwnerFilter}
        />
      )}
      {workspace === "events" && (
        <EventsOverview
          events={data.events}
          profiles={data.profiles}
          canManageEvents={canManageTaskMeta}
          pending={isPending}
          message={eventMessage}
          onCreateEvent={createFounderEvent}
          onUpdateEvent={updateFounderEvent}
        />
      )}
      {workspace === "tools" && <FmdToolsOverview tools={data.fmdTools} />}
      {workspace === "team" && (
        <TeamOverview
          data={data}
          tasks={data.tasks}
          pending={isPending}
          canManageTeam={source === "seed" || currentProfile?.platformRole === "ceo"}
          onSaveProfileSettings={saveProfileSettings}
        />
      )}
      {workspace === "profile" && (
        <ProfileSettingsOverview
          data={data}
          currentProfile={currentProfile}
          expandedPackages={expandedPackages}
          filters={filters}
          pending={isPending}
          source={source}
          view={view}
          workspace={workspace}
          onSaveOwnProfileSettings={saveOwnProfileSettings}
        />
      )}
      {workspace === "sprint" && (
        <SprintScoreTableOverview
          data={data}
          pending={isPending}
          onOpen={(task) => openTaskPanel(task.id)}
          onReview={reviewTask}
          onReopenReview={reopenReviewTask}
          onRequestReview={(task) => updateTask(task, { status: "Review", reviewStatus: "requested", scoreFinal: false })}
          onChangeStatus={(task, status) => updateTask(task, { status })}
          onLockSprint={lockSprint}
          onUpdateSprint={updateSprint}
          onUpdateCommitment={updateSprintCommitment}
          onUpdateMeetingAttendance={updateMeetingAttendance}
          onCreateScoreObjection={createScoreObjection}
          onReviewScoreObjection={reviewScoreObjection}
          onAssignSprint={(task, sprintId) => updateTask(task, { sprintId })}
          currentProfile={currentProfile}
          canManageSprint={currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy"}
          sprintLockMessage={sprintLockMessage}
          focusedReviewTaskId={focusedReviewTaskId}
          onFocusedReviewTaskHandled={() => setFocusedReviewTaskId("")}
        />
      )}
      {workspace === "settings" && (
        <SettingsOverview
          data={data}
          source={source}
          authAvailable={controller.authAvailable}
          authUserEmail={controller.authUser?.email || ""}
          githubAppConnected={controller.githubAppConnected}
          pending={isPending}
          feedbackMessage={feedbackMessage}
          selectedFeedbackId={selectedFeedbackId}
          notificationDispatchMessage={notificationDispatchMessage}
          googleChatStatus={googleChatStatus}
          sprintPlanningOptions={sprintPlanningOptions}
          plannedSprintCount={futureSprintDrafts(data.sprints, sprintPlanningOptions, new Set(data.tasks.filter((task) => task.sprintId).map((task) => task.sprintId))).length}
          onUpdateSprintPlanning={setSprintPlanningOptions}
          onCreateSprintPlan={createSprintPlan}
          onDispatchNotifications={dispatchNotifications}
          onRetryNotificationDelivery={retryNotificationDelivery}
          onSendGoogleChatTest={sendGoogleChatTest}
          onSelectFeedback={setSelectedFeedbackId}
        />
      )}
      <TaskGitHubSyncQueue
        open={githubSyncQueueOpen}
        tasks={data.tasks}
        pending={isPending}
        githubAppConnected={githubAppConnected}
        onClose={() => setGithubSyncQueueOpen(false)}
        onOpenTask={(task) => openTaskPanel(task.id)}
        onSyncLinkedGitHubTasks={syncLinkedGitHubTasks}
        onSyncTaskToGitHub={syncTaskToGitHub}
      />
      <PlanningTaskViewRenderer controller={controller} />
    </section>
  );
}
