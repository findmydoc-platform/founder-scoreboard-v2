"use client";

import dynamic from "next/dynamic";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { futureSprintDrafts } from "@/features/planning/model/planning-app-model";
import { PlanningTaskViewRenderer } from "@/features/planning/organisms/planning-task-view-renderer";
import { WorkspaceContentSkeleton } from "@/features/planning/templates/workspace-loading-shell";
import { TaskGitHubSyncQueue } from "@/features/tasks/organisms/task-github-sync-queue";
import { UiPanel } from "@/shared/atoms/ui-primitives";
import { canManageEpics } from "@/features/projects/model/epic-policy";
import type { NotionDecisionLogResult } from "@/lib/notion-decision-log";
import { isLocalLoginSimulationEnabled } from "@/lib/local-development-auth";
import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import type { SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";
import { isTeamWorkweekStarterProfile } from "@/features/team-workweek/model/team-workweek-matrix";

const GenericWorkspacePanelLoading = () => <WorkspaceContentSkeleton variant="generic" />;
const BacklogWorkspacePanelLoading = () => <WorkspaceContentSkeleton variant="backlog" />;
const EventsWorkspacePanelLoading = () => <WorkspaceContentSkeleton variant="events" />;

const BacklogOverview = dynamic(() => import("@/features/backlog/organisms/backlog-overview").then((mod) => mod.BacklogOverview), { loading: BacklogWorkspacePanelLoading });
const EventsOverview = dynamic(() => import("@/features/events/organisms/events-overview").then((mod) => mod.EventsOverview), { loading: EventsWorkspacePanelLoading });
const ProjectsOverview = dynamic(() => import("@/features/projects/organisms/projects-overview").then((mod) => mod.ProjectsOverview), { loading: GenericWorkspacePanelLoading });
const ProfileSettingsOverview = dynamic(() => import("@/features/profile/organisms/profile-settings-overview").then((mod) => mod.ProfileSettingsOverview), { loading: GenericWorkspacePanelLoading });
const NotificationsOverview = dynamic(() => import("@/features/notifications/organisms/notifications-overview").then((mod) => mod.NotificationsOverview), { loading: GenericWorkspacePanelLoading });
const DecisionLogOverview = dynamic(() => import("@/features/decision-log/organisms/decision-log-overview").then((mod) => mod.DecisionLogOverview), { loading: GenericWorkspacePanelLoading });
const SprintScoreTableOverview = dynamic(() => import("@/features/sprint/organisms/sprint-score-overview").then((mod) => mod.SprintScoreTableOverview), { loading: GenericWorkspacePanelLoading });
const FmdQuickLinksOverview = dynamic(() => import("@/features/tools/organisms/fmd-quick-links-overview").then((mod) => mod.FmdQuickLinksOverview), { loading: GenericWorkspacePanelLoading });
const TeamOverview = dynamic(() => import("@/features/team/organisms/team-overview").then((mod) => mod.TeamOverview), { loading: GenericWorkspacePanelLoading });

type PlanningWorkspaceRendererProps = {
  controller: PlanningAppController;
  source: "supabase";
  decisionLogResult?: NotionDecisionLogResult;
  initialBacklogModel?: BacklogModel;
  initialSprintModel?: SprintWorkspaceModel;
};

export function PlanningWorkspaceRenderer({ controller, source, decisionLogResult, initialBacklogModel, initialSprintModel }: PlanningWorkspaceRendererProps) {
  const {
    actualProfile,
    authBusy,
    canManageTaskMeta,
    createFounderEvent,
    createScoreObjection,
    createSprintPlan,
    currentProfile,
    data,
    decideInitiativeApproval,
    dismissNotification,
    dispatchNotifications,
    eventMessage,
    fmdToolMessage,
    fmdToolPending,
    googleChatStatus,
    githubConnectionState,
    githubInstallationAvailable,
    githubReauthFailed,
    githubSyncNotice,
    githubSyncQueueOpen,
    githubUserConnected,
    isPending,
    lockSprint,
    notificationDispatchMessage,
    openNotification,
    openTaskPanel,
    apiClient,
    retryNotificationDelivery,
    reviewScoreObjection,
    saveProfileSettings,
    saveOwnProfileSettings,
    saveFounderOpsGitHubProject,
    saveFounderOpsReviewWindow,
    sendGoogleChatTest,
    setGithubSyncQueueOpen,
    setInitiativeDialogDefaults,
    setEpicDeleteTarget,
    setEpicDialogDefaults,
    setTaskDialogDefaults,
    setSprintPlanningOptions,
    signIn,
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
    waitingGitHubCommentCount,
    withdrawInitiative,
    workspace,
  } = controller;
  const canManageSprint = currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy";
  const canManageProjectEpics = canManageEpics(currentProfile?.platformRole);
  const canManageNotificationsOutbox = !currentProfile || currentProfile.platformRole === "ceo" || currentProfile.platformRole === "deputy";

  return (
    <section className="min-w-0 px-4 pb-8 pt-4 lg:px-6">
      {workspace === "decision-log" && decisionLogResult && <DecisionLogOverview result={decisionLogResult} />}
      {workspace === "decision-log" && !decisionLogResult && (
        <UiPanel padding="xl">
          <h2 className="text-lg font-semibold text-slate-950">Decision Log nicht verfügbar</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Für diesen Seitenaufruf wurden keine Notion-Daten geladen.</p>
        </UiPanel>
      )}
      {workspace === "projects" && (
        <ProjectsOverview
          data={data}
          tasks={data.tasks}
          currentProfile={currentProfile}
          canManageInitiatives={canManageTaskMeta}
          canManageEpics={canManageProjectEpics}
          pending={isPending}
          onCreateEpic={() => setEpicDialogDefaults({})}
          onEditEpic={(epic) => setEpicDialogDefaults({
            id: epic.id,
            title: epic.title,
            description: epic.description,
            targetDate: epic.targetDate,
            status: epic.status === "In Arbeit" ? "active" : epic.status === "Erledigt" ? "done" : "planned",
            expectedUpdatedAt: epic.updatedAt,
          })}
          onDeleteEpic={(epic, children) => setEpicDeleteTarget({ epic: epic, children })}
          onOpenTask={openTaskPanel}
          onDecideInitiative={decideInitiativeApproval}
          onWithdrawInitiative={withdrawInitiative}
          onEditInitiative={(initiative) => setInitiativeDialogDefaults({
            id: initiative.id,
            expectedUpdatedAt: initiative.updatedAt,
            title: initiative.title,
            parentTaskId: initiative.parentTaskId || "",
            ownerId: initiative.ownerId || "",
            accountableProfileId: initiative.raciAssignments?.find((assignment) => assignment.role === "accountable")?.profileId || initiative.ownerId || "",
            responsibleProfileIds: initiative.raciAssignments?.filter((assignment) => assignment.role === "responsible").map((assignment) => assignment.profileId) || [],
            consultedProfileIds: initiative.raciAssignments?.filter((assignment) => assignment.role === "consulted").map((assignment) => assignment.profileId) || [],
            informedProfileIds: initiative.raciAssignments?.filter((assignment) => assignment.role === "informed").map((assignment) => assignment.profileId) || [],
            priority: initiative.priority,
            status: initiative.status === "In Arbeit" ? "active" : initiative.status === "Erledigt" ? "done" : initiative.status === "Pausiert" ? "paused" : "planned",
            targetDate: initiative.targetDate || "",
            goal: initiative.strategy?.goal || initiative.description,
            successCriteria: initiative.strategy?.successCriteria || "",
            scopeConstraints: initiative.strategy?.scopeConstraints || "",
            approvalStatus: initiative.approvalStatus || "proposed",
            approvalRevision: initiative.approvalRevision,
            decisionNote: initiative.decisionNote,
          })}
        />
      )}
      {workspace === "backlog" && (
        initialBacklogModel ? <BacklogOverview
          apiClient={apiClient}
          canManageBacklog={canManageTaskMeta}
          initialModel={initialBacklogModel}
          onOpenTask={openTaskPanel}
          onCreatePlanningItem={(taskType) => setTaskDialogDefaults({ taskType })}
          onProposeDeliverable={() => setTaskDialogDefaults({ taskType: "deliverable" })}
        /> : null
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
          actualProfile={actualProfile}
          apiClient={apiClient}
          data={data}
          tasks={data.tasks}
          pending={isPending}
          canManageTeam={currentProfile?.platformRole === "ceo"}
          teamWorkweekAvailable={isTeamWorkweekStarterProfile(data.profiles, currentProfile)}
          onSaveProfileSettings={saveProfileSettings}
        />
      )}
      {workspace === "profile" && (
        <ProfileSettingsOverview
          apiClient={apiClient}
          data={data}
          currentProfile={currentProfile}
          pending={isPending}
          source={source}
          onSaveOwnProfileSettings={saveOwnProfileSettings}
          onSaveFounderOpsGitHubProject={saveFounderOpsGitHubProject}
          onSaveFounderOpsReviewWindow={saveFounderOpsReviewWindow}
        />
      )}
      {workspace === "sprint" && (
        initialSprintModel ? <SprintScoreTableOverview
          initialModel={initialSprintModel}
          data={data}
          pending={isPending}
          onOpenTask={openTaskPanel}
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
          plannedSprintCount={futureSprintDrafts(
            data.sprints,
            sprintPlanningOptions,
            new Set(data.tasks.filter((task) => task.sprintId).map((task) => task.sprintId)),
            data.project.reviewObjectionWindowHours,
          ).length}
          onUpdateSprintPlanning={setSprintPlanningOptions}
          onCreateSprintPlan={createSprintPlan}
          currentProfile={currentProfile}
          canManageSprint={canManageSprint}
          sprintLockMessage={sprintLockMessage}
        /> : null
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
        githubUserConnected={githubUserConnected}
        githubConnectionState={githubConnectionState}
        waitingGitHubCommentCount={waitingGitHubCommentCount}
        githubReauthFailed={githubReauthFailed}
        authBusy={authBusy}
        localMode={isLocalLoginSimulationEnabled()}
        notice={githubSyncNotice}
        onClose={() => setGithubSyncQueueOpen(false)}
        onOpenTask={openTaskPanel}
        onReconnect={() => signIn({ githubReconnect: true, clearReconnectGuard: true })}
        onSyncLinkedGitHubTasks={syncLinkedGitHubTasks}
        onSyncTaskToGitHub={syncTaskToGitHub}
      />
      <PlanningTaskViewRenderer controller={controller} />
    </section>
  );
}
