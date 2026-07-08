import { CeoTaskIntake } from "@/features/intake/organisms/ceo-task-intake";
import { EventsOverview } from "@/features/events/organisms/events-overview";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { futureSprintDrafts, sortTasks } from "@/features/planning/model/planning-app-model";
import { PlanningTaskViewRenderer } from "@/features/planning/organisms/planning-task-view-renderer";
import { ExecutionLayerOverview } from "@/features/execution/organisms/execution-layer-overview";
import { ProjectsOverview } from "@/features/projects/organisms/projects-overview";
import { ProfileSettingsOverview } from "@/features/profile/organisms/profile-settings-overview";
import { ReviewWorkspaceOverview } from "@/features/reviews/organisms/review-workspace-overview";
import { SettingsOverview } from "@/features/settings/organisms/settings-overview";
import { SprintScoreTableOverview } from "@/features/sprint/organisms/sprint-score-overview";
import { FmdToolsOverview } from "@/features/tools/organisms/fmd-tools-overview";
import { TeamOverview } from "@/features/team/organisms/team-overview";
import { TaskGitHubSyncQueue } from "@/features/tasks/organisms/task-github-sync-queue";
import { UiPanel } from "@/shared/atoms/ui-primitives";

type PlanningWorkspaceRendererProps = {
  controller: PlanningAppController;
  source: "seed" | "supabase";
};

export function PlanningWorkspaceRenderer({ controller, source }: PlanningWorkspaceRendererProps) {
  const {
    canManageTaskMeta,
    canUseCeoIntake,
    createFounderEvent,
    createScoreObjection,
    createSprintPlan,
    currentProfile,
    currentProfileFocusItems,
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
    hygieneAlerts,
    isPending,
    lockSprint,
    notificationDispatchMessage,
    openTaskPanel,
    removeFocusItem,
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
    upsertFocusItem,
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
      {workspace === "execution" && (
        <ExecutionLayerOverview
          data={data}
          currentProfile={currentProfile}
          focusItems={currentProfileFocusItems}
          hygieneAlerts={hygieneAlerts}
          pending={isPending}
          onOpenTask={(task) => openTaskPanel(task.id)}
          onSetFocus={upsertFocusItem}
          onRemoveFocus={removeFocusItem}
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
