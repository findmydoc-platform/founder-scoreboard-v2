"use client";

import dynamic from "next/dynamic";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { futureSprintDrafts, sortTasks } from "@/features/planning/model/planning-app-model";
import { PlanningTaskViewRenderer } from "@/features/planning/organisms/planning-task-view-renderer";
import { WorkspaceContentSkeleton } from "@/features/planning/templates/workspace-loading-shell";
import { TaskGitHubSyncQueue } from "@/features/tasks/organisms/task-github-sync-queue";
import { UiPanel } from "@/shared/atoms/ui-primitives";
import { canManageMilestones } from "@/features/projects/model/milestone-policy";

const GenericWorkspacePanelLoading = () => <WorkspaceContentSkeleton variant="generic" />;
const BacklogWorkspacePanelLoading = () => <WorkspaceContentSkeleton variant="backlog" />;
const EventsWorkspacePanelLoading = () => <WorkspaceContentSkeleton variant="events" />;
const ReviewsWorkspacePanelLoading = () => <WorkspaceContentSkeleton variant="reviews" />;

const CeoTaskIntake = dynamic(() => import("@/features/intake/organisms/ceo-task-intake").then((mod) => mod.CeoTaskIntake), { loading: GenericWorkspacePanelLoading });
const BacklogOverview = dynamic(() => import("@/features/backlog/organisms/backlog-overview").then((mod) => mod.BacklogOverview), { loading: BacklogWorkspacePanelLoading });
const EventsOverview = dynamic(() => import("@/features/events/organisms/events-overview").then((mod) => mod.EventsOverview), { loading: EventsWorkspacePanelLoading });
const ProjectsOverview = dynamic(() => import("@/features/projects/organisms/projects-overview").then((mod) => mod.ProjectsOverview), { loading: GenericWorkspacePanelLoading });
const ProfileSettingsOverview = dynamic(() => import("@/features/profile/organisms/profile-settings-overview").then((mod) => mod.ProfileSettingsOverview), { loading: GenericWorkspacePanelLoading });
const ReviewWorkspaceOverview = dynamic(() => import("@/features/reviews/organisms/review-workspace-overview").then((mod) => mod.ReviewWorkspaceOverview), { loading: ReviewsWorkspacePanelLoading });
const NotificationsOverview = dynamic(() => import("@/features/notifications/organisms/notifications-overview").then((mod) => mod.NotificationsOverview), { loading: GenericWorkspacePanelLoading });
const SprintScoreTableOverview = dynamic(() => import("@/features/sprint/organisms/sprint-score-overview").then((mod) => mod.SprintScoreTableOverview), { loading: GenericWorkspacePanelLoading });
const FmdQuickLinksOverview = dynamic(() => import("@/features/tools/organisms/fmd-quick-links-overview").then((mod) => mod.FmdQuickLinksOverview), { loading: GenericWorkspacePanelLoading });
const TeamOverview = dynamic(() => import("@/features/team/organisms/team-overview").then((mod) => mod.TeamOverview), { loading: GenericWorkspacePanelLoading });

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
    data,
    decideInitiativeApproval,
    dismissNotification,
    dispatchNotifications,
    eventMessage,
    expandedPackages,
    filters,
    focusedReviewTaskId,
    fmdToolMessage,
    fmdToolPending,
    googleChatStatus,
    githubInstallationAvailable,
    githubSyncNotice,
    githubSyncQueueOpen,
    isPending,
    lockSprint,
    notificationDispatchMessage,
    openNotification,
    openTaskPanel,
    reopenReviewTask,
    refreshPlanningData,
    apiClient,
    retryNotificationDelivery,
    reviewScoreObjection,
    reviewTask,
    saveProfileSettings,
    saveOwnProfileSettings,
    sendGoogleChatTest,
    setData,
    setFocusedReviewTaskId,
    setGithubSyncQueueOpen,
    setInitiativeDialogDefaults,
    setMilestoneDeleteTarget,
    setMilestoneDialogDefaults,
    setTaskDialogDefaults,
    setSprintPlanningOptions,
    sprintLockMessage,
    sprintPlanningOptions,
    createFmdTool,
    loadFmdToolMetadata,
    updateFmdTool,
    uploadFmdToolPreviewImage,
    syncLinkedGitHubTasks,
    syncTaskToGitHub,
    updateFounderEvent,
    updateMeetingAttendance,
    updateSprint,
    updateSprintCommitment,
    updateTask,
    withdrawInitiative,
    view,
    workspace,
  } = controller;
  const canManageSprint = currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy";
  const canManageProjectMilestones = canManageMilestones(currentProfile?.platformRole, source);
  const canManageNotificationsOutbox = source === "seed" || !currentProfile || currentProfile.platformRole === "ceo" || currentProfile.platformRole === "deputy";

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
          source={source}
          canManageInitiatives={canManageTaskMeta}
          canManageMilestones={canManageProjectMilestones}
          pending={isPending}
          onCreateMilestone={() => setMilestoneDialogDefaults({})}
          onEditMilestone={(milestone) => setMilestoneDialogDefaults({
            id: milestone.id,
            title: milestone.title,
            description: milestone.description,
            targetDate: milestone.targetDate,
            status: milestone.status,
            expectedUpdatedAt: milestone.updatedAt,
          })}
          onDeleteMilestone={(milestone, children) => setMilestoneDeleteTarget({ milestone, children })}
          onOpenTask={openTaskPanel}
          onDecideInitiative={decideInitiativeApproval}
          onWithdrawInitiative={withdrawInitiative}
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
            approvalStatus: initiative.approvalStatus,
            approvalRevision: initiative.approvalRevision,
            decisionNote: initiative.decisionNote,
          })}
        />
      )}
      {workspace === "backlog" && (
        <BacklogOverview
          apiClient={apiClient}
          canManageBacklog={canManageTaskMeta}
          data={data}
          onOpenTask={openTaskPanel}
          onProposeDeliverable={() => setTaskDialogDefaults({ taskType: "deliverable" })}
          onUpdateTask={updateTask}
          refreshPlanningData={refreshPlanningData}
          setData={setData}
          source={source}
        />
      )}
      {workspace === "reviews" && (
        <ReviewWorkspaceOverview
          data={data}
          currentProfile={currentProfile}
          onOpenTask={openTaskPanel}
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
      {workspace === "tools" && (
        <FmdQuickLinksOverview
          tools={data.fmdTools}
          source={source}
          currentProfile={currentProfile}
          pending={fmdToolPending}
          message={fmdToolMessage}
          onCreateTool={createFmdTool}
          onLoadMetadata={loadFmdToolMetadata}
          onUpdateTool={updateFmdTool}
          onUploadPreviewImage={uploadFmdToolPreviewImage}
        />
      )}
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
          apiClient={apiClient}
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
          onOpenTask={openTaskPanel}
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
          sprintPlanningOptions={sprintPlanningOptions}
          plannedSprintCount={futureSprintDrafts(data.sprints, sprintPlanningOptions, new Set(data.tasks.filter((task) => task.sprintId).map((task) => task.sprintId))).length}
          onUpdateSprintPlanning={setSprintPlanningOptions}
          onCreateSprintPlan={createSprintPlan}
          currentProfile={currentProfile}
          canManageSprint={canManageSprint}
          sprintLockMessage={sprintLockMessage}
          focusedReviewTaskId={focusedReviewTaskId}
          onFocusedReviewTaskHandled={() => setFocusedReviewTaskId("")}
        />
      )}
      {workspace === "notifications" && (
        <NotificationsOverview
          canManageOutbox={canManageNotificationsOutbox}
          currentProfile={currentProfile}
          data={data}
          pending={isPending}
          notificationDispatchMessage={notificationDispatchMessage}
          googleChatStatus={googleChatStatus}
          onDispatchNotifications={dispatchNotifications}
          onOpenNotification={openNotification}
          onDismissNotification={dismissNotification}
          onRetryNotificationDelivery={retryNotificationDelivery}
          onSendGoogleChatTest={sendGoogleChatTest}
        />
      )}
      <TaskGitHubSyncQueue
        open={githubSyncQueueOpen}
        tasks={data.tasks}
        comments={data.taskComments}
        pending={isPending}
        githubInstallationAvailable={githubInstallationAvailable}
        notice={githubSyncNotice}
        onClose={() => setGithubSyncQueueOpen(false)}
        onOpenTask={openTaskPanel}
        onSyncLinkedGitHubTasks={syncLinkedGitHubTasks}
        onSyncTaskToGitHub={syncTaskToGitHub}
      />
      <PlanningTaskViewRenderer controller={controller} />
    </section>
  );
}
