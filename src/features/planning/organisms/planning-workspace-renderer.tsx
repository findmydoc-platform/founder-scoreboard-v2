"use client";

import dynamic from "next/dynamic";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { futureSprintDrafts } from "@/features/planning/model/planning-app-model";
import { PlanningTaskViewRenderer } from "@/features/planning/organisms/planning-task-view-renderer";
import { WorkspaceContentSkeleton } from "@/features/planning/templates/workspace-loading-shell";
import { TaskGitHubSyncQueue } from "@/features/tasks/organisms/task-github-sync-queue";
import { canManageEpics } from "@/features/projects/model/epic-policy";
import { isLocalLoginSimulationEnabled } from "@/lib/local-development-auth";
import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import type { SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";
import type { AuthorityCapabilities } from "@/features/administrator-access/model/administrator-access";
import type { AdministrationWorkspaceModel } from "@/features/administration/model/administration-read-model";

const GenericWorkspacePanelLoading = () => <WorkspaceContentSkeleton variant="generic" />;
const BacklogWorkspacePanelLoading = () => <WorkspaceContentSkeleton variant="backlog" />;
const EventsWorkspacePanelLoading = () => <WorkspaceContentSkeleton variant="events" />;

const BacklogOverview = dynamic(() => import("@/features/backlog/organisms/backlog-overview").then((mod) => mod.BacklogOverview), { loading: BacklogWorkspacePanelLoading });
const EventsOverview = dynamic(() => import("@/features/events/organisms/events-overview").then((mod) => mod.EventsOverview), { loading: EventsWorkspacePanelLoading });
const ProjectsOverview = dynamic(() => import("@/features/projects/organisms/projects-overview").then((mod) => mod.ProjectsOverview), { loading: GenericWorkspacePanelLoading });
const ProfileSettingsOverview = dynamic(() => import("@/features/profile/organisms/profile-settings-overview").then((mod) => mod.ProfileSettingsOverview), { loading: GenericWorkspacePanelLoading });
const NotificationsOverview = dynamic(() => import("@/features/notifications/organisms/notifications-overview").then((mod) => mod.NotificationsOverview), { loading: GenericWorkspacePanelLoading });
const PlanningDecisionLog = dynamic(() => import("@/features/decision-log/organisms/planning-decision-log").then(mod => mod.PlanningDecisionLog), { loading: GenericWorkspacePanelLoading });
const SprintScoreTableOverview = dynamic(() => import("@/features/sprint/organisms/sprint-score-overview").then((mod) => mod.SprintScoreTableOverview), { loading: GenericWorkspacePanelLoading });
const FmdQuickLinksOverview = dynamic(() => import("@/features/tools/organisms/fmd-quick-links-overview").then((mod) => mod.FmdQuickLinksOverview), { loading: GenericWorkspacePanelLoading });
const TeamOverview = dynamic(() => import("@/features/team/organisms/team-overview").then((mod) => mod.TeamOverview), { loading: GenericWorkspacePanelLoading });
const AdministrationWorkspaceHost = dynamic(() => import("@/features/administration/organisms/administration-workspace-host").then((mod) => mod.AdministrationWorkspaceHost), { loading: GenericWorkspacePanelLoading });

type PlanningWorkspaceRendererProps = {
  controller: PlanningAppController;
  administrationCapabilities: AuthorityCapabilities;
  initialAdministrationModel?: AdministrationWorkspaceModel | null;
  onAdministratorAccessInvalid: () => void;
  source: "supabase";
  initialBacklogModel?: BacklogModel;
  initialSprintModel?: SprintWorkspaceModel;
};

export function PlanningWorkspaceRenderer({ controller, administrationCapabilities, initialAdministrationModel = null, onAdministratorAccessInvalid, source, initialBacklogModel, initialSprintModel }: PlanningWorkspaceRendererProps) {
  const {
    actualProfile,
    authBusy,
    canManageTaskMeta,
    createFounderEvent,
    planningState,
    currentProfile,
    data,
    decideInitiativeApproval,
    dismissNotification,
    eventMessage,
    fmdToolMessage,
    fmdToolPending,
    githubConnectionState,
    githubInstallationAvailable,
    githubReauthFailed,
    githubSyncNotice,
    githubSyncQueueOpen,
    githubUserConnected,
    isPending,
    openNotification,
    openTaskPanel,
    apiClient,
    saveProfileSettings,
    saveOwnProfileSettings,
    setGithubSyncQueueOpen,
    editInitiative,
    setEpicDeleteTarget,
    setEpicDialogDefaults,
    setTaskDialogDefaults,
    setSprintPlanningOptions,
    signIn,
    sprintPlanningOptions,
    createFmdTool,
    loadFmdToolMetadata,
    updateFmdTool,
    uploadFmdToolPreviewImage,
    syncLinkedGitHubTasks,
    syncTaskToGitHub,
    updateFounderEvent,
    updateTask,
    waitingGitHubCommentCount,
    withdrawInitiative,
    workspace,
  } = controller;
  const canManageSprint = currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy";
  const canManageProjectEpics = canManageEpics(currentProfile?.platformRole);

  return (
    <section className="min-w-0 px-4 pb-8 pt-4 lg:px-6">
      {workspace === "decision-log" && <PlanningDecisionLog planningState={planningState} />}
      {workspace === "projects" && (
        <ProjectsOverview
          planningState={planningState}
          data={{ ...data, tasks: [...planningState.hierarchy().tasks] }}
          tasks={[...planningState.hierarchy().tasks]}
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
          onEditInitiative={editInitiative}
        />
      )}
      {workspace === "backlog" && (
        initialBacklogModel ? <BacklogOverview
          planningState={planningState}
          canManageBacklog={canManageTaskMeta}
          onOpenTask={openTaskPanel}
          onCreatePlanningItem={(taskType) => setTaskDialogDefaults({ taskType })}
          onProposeDeliverable={() => setTaskDialogDefaults({ taskType: "deliverable" })}
        /> : null
      )}
      {workspace === "events" && (
        <EventsOverview
          planningState={planningState}
          events={data.events}
          profiles={data.profiles}
          canManageEvents={canManageTaskMeta || controller.canCorrectOperationally}
          pending={isPending}
          message={eventMessage}
          onCreateEvent={createFounderEvent}
          onUpdateEvent={updateFounderEvent}
        />
      )}
      {workspace === "tools" && (
        <FmdQuickLinksOverview
          planningState={planningState}
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
          planningState={controller.planningState}
          tasks={data.tasks}
          pending={isPending}
          canManageTeam={currentProfile?.platformRole === "ceo"}
          onSaveProfileSettings={saveProfileSettings}
        />
      )}
      {workspace === "profile" && (
        <ProfileSettingsOverview
          planningState={controller.planningState}
          data={data}
          currentProfile={currentProfile}
          pending={isPending}
          source={source}
          onSaveOwnProfileSettings={saveOwnProfileSettings}
        />
      )}
      {workspace === "sprint" && (
        initialSprintModel ? <SprintScoreTableOverview
          planningState={controller.planningState}
          pending={isPending}
          onOpenTask={openTaskPanel}
          onRequestReview={async (task, evidence) => {
            const result = await updateTask(task, {
              status: "Review",
              reviewStatus: "requested",
              scoreFinal: false,
              ...(evidence?.evidenceLink ? { evidenceLinks: [...task.evidenceLinks, evidence.evidenceLink] } : {}),
              reviewEvidenceExceptionNote: evidence?.evidenceExceptionNote || "",
            });
            return result.ok;
          }}
          onChangeStatus={(task, status) => updateTask(task, { status })}
          onAssignSprint={(task, sprintId) => updateTask(task, { sprintId })}
          sprintPlanningOptions={sprintPlanningOptions}
          plannedSprintCount={futureSprintDrafts(
            data.sprints,
            sprintPlanningOptions,
            new Set(data.tasks.filter((task) => task.sprintId).map((task) => task.sprintId)),
            data.project.reviewObjectionWindowHours,
          ).length}
          onUpdateSprintPlanning={setSprintPlanningOptions}
          currentProfile={currentProfile}
          canManageSprint={canManageSprint}
          reviewObjectionWindowHours={data.project.reviewObjectionWindowHours}
        /> : null
      )}
      {workspace === "notifications" && (
        <NotificationsOverview
          completeness={planningState.notifications().completeness}
          readStatus={planningState.notifications().readStatus}
          pendingEventIds={planningState.notifications().operations.filter(operation => operation.phase === "saving" || operation.phase === "unconfirmed").flatMap(operation => operation.eventId || [])}
          currentProfile={currentProfile}
          data={data}
          onOpenNotification={openNotification}
          onDismissNotification={dismissNotification}
        />
      )}
      {workspace === "administration" && (
        <AdministrationWorkspaceHost
          apiClient={apiClient}
          planningState={controller.planningState}
          capabilities={administrationCapabilities}
          initialModel={initialAdministrationModel}
          onAdministratorAccessInvalid={onAdministratorAccessInvalid}
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
        syncOperations={controller.planningState.taskGitHubSyncs()}
        onCheckSync={id=>{void controller.planningState.checkTaskGitHubSync(id);}}
        onSyncLinkedGitHubTasks={syncLinkedGitHubTasks}
        onSyncTaskToGitHub={syncTaskToGitHub}
      />
      <PlanningTaskViewRenderer controller={controller} />
    </section>
  );
}
