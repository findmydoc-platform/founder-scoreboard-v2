import { CeoTaskIntake } from "@/features/intake/organisms/ceo-task-intake";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { futureSprintDrafts, sortTasks } from "@/features/planning/model/planning-app-model";
import { PlanningTaskViewRenderer } from "@/features/planning/organisms/planning-task-view-renderer";
import { DecisionLogOverview } from "@/features/decisions/organisms/decision-log-overview";
import { ExecutionLayerOverview } from "@/features/execution/organisms/execution-layer-overview";
import { MeetingFinderOverview } from "@/features/meetings/organisms/meeting-finder-overview";
import { ProjectsOverview } from "@/features/projects/organisms/projects-overview";
import { ReviewWorkspaceOverview } from "@/features/reviews/organisms/review-workspace-overview";
import { SettingsOverview } from "@/features/settings/organisms/settings-overview";
import { SprintScoreTableOverview } from "@/features/sprint/organisms/sprint-score-overview";
import { FmdToolsOverview } from "@/features/tools/organisms/fmd-tools-overview";
import { TeamOverview } from "@/features/team/organisms/team-overview";

type PlanningWorkspaceRendererProps = {
  controller: PlanningAppController;
  source: "seed" | "supabase";
};

export function PlanningWorkspaceRenderer({ controller, source }: PlanningWorkspaceRendererProps) {
  const {
    calendarSyncMessage,
    canManageTaskMeta,
    canUseCeoIntake,
    confirmDecision,
    createAvailability,
    createDecision,
    createMeetingFromSlot,
    createScoreObjection,
    createSprintPlan,
    currentProfile,
    currentProfileFocusItems,
    data,
    deleteAvailability,
    dispatchNotifications,
    editDecision,
    feedbackMessage,
    focusedReviewTaskId,
    googleChatStatus,
    hygieneAlerts,
    isPending,
    linkDecisionTask,
    lockSprint,
    meetingCreateMessage,
    notificationDispatchMessage,
    objectDecision,
    openTaskPanel,
    removeDecisionTaskLink,
    removeFocusItem,
    reopenReviewTask,
    requestHeaders,
    retryNotificationDelivery,
    reviewOwnerFilter,
    reviewScoreObjection,
    reviewStatusFilter,
    reviewTask,
    saveProfileSettings,
    selectedFeedbackId,
    sendGoogleChatTest,
    setData,
    setFocusedReviewTaskId,
    setInitiativeDialogDefaults,
    setReviewOwnerFilter,
    setReviewStatusFilter,
    setSelectedFeedbackId,
    setSprintPlanningOptions,
    setTaskDialogDefaults,
    sprintLockMessage,
    sprintPlanningOptions,
    syncGoogleCalendar,
    syncLinkedGitHubTasks,
    syncTaskToGitHub,
    updateAvailability,
    updateMeeting,
    updateMeetingAttendance,
    updateSprint,
    updateSprintCommitment,
    updateTask,
    upsertFocusItem,
    workspace,
    signIn,
  } = controller;

  return (
    <section className="min-w-0 px-4 pb-8 pt-4 lg:px-6">
      {workspace === "ceo-intake" && canUseCeoIntake && (
        <CeoTaskIntake
          source={source}
          profiles={data.profiles}
          packages={data.packages}
          sprints={data.sprints}
          requestHeaders={requestHeaders}
          onTasksCreated={(tasks) => {
            setData((current) => ({
              ...current,
              tasks: sortTasks([...current.tasks, ...tasks]),
            }));
          }}
        />
      )}
      {workspace === "ceo-intake" && !canUseCeoIntake && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">CEO Intake ist geschützt</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Dieser Bereich ist ausschließlich für die CEO-Rolle freigeschaltet. Deputy, Founder, Accountable, Responsible und Assignee haben hier keinen Zugriff.
          </p>
        </section>
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
          onLinkDecisionTask={linkDecisionTask}
          onRemoveDecisionTaskLink={removeDecisionTaskLink}
          onCreateTask={(draft) => setTaskDialogDefaults(draft)}
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
      {workspace === "tools" && <FmdToolsOverview tools={data.fmdTools} />}
      {workspace === "team" && (
        <TeamOverview
          data={data}
          tasks={data.tasks}
          pending={isPending}
          canManageTeam={source === "seed" || currentProfile?.platformRole === "ceo"}
          currentProfileId={currentProfile?.id || ""}
          onSaveProfileSettings={saveProfileSettings}
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
      {workspace === "decisions" && (
        <DecisionLogOverview
          data={data}
          currentProfileId={currentProfile?.id || ""}
          pending={isPending}
          onCreate={createDecision}
          onConfirm={confirmDecision}
          onEdit={editDecision}
          onObject={objectDecision}
          onRemoveDecisionTaskLink={removeDecisionTaskLink}
          onCreateFollowUp={(decision) => setTaskDialogDefaults({
            taskType: "deliverable",
            title: `${decision.title} umsetzen`,
            description: decision.context,
            problemStatement: decision.context,
            intendedOutcome: decision.decision,
            acceptanceCriteria: decision.decision,
            definitionOfDone: decision.decision,
            decisionId: decision.id,
            decisionLinkNote: "Folgeaufgabe aus Decision Log",
          })}
        />
      )}
      {workspace === "meetings" && (
        <MeetingFinderOverview
          data={data}
          pending={isPending}
          currentProfile={currentProfile}
          canManageAvailability={source === "seed" || currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy"}
          canCreateMeeting={source === "seed" || currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy" || currentProfile?.platformRole === "founder"}
          calendarSyncMessage={calendarSyncMessage}
          meetingCreateMessage={meetingCreateMessage}
          onCreateAvailability={createAvailability}
          onUpdateAvailability={updateAvailability}
          onDeleteAvailability={deleteAvailability}
          onSyncGoogleCalendar={syncGoogleCalendar}
          onCreateMeeting={createMeetingFromSlot}
          onUpdateMeeting={updateMeeting}
        />
      )}
      {workspace === "settings" && (
        <SettingsOverview
          data={data}
          source={source}
          authAvailable={controller.authAvailable}
          authUserEmail={controller.authUser?.email || ""}
          githubProviderTokenAvailable={controller.githubProviderTokenAvailable}
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
          onReconnectGitHub={signIn}
          onSyncLinkedGitHubTasks={syncLinkedGitHubTasks}
          onCreateGitHubIssue={(task) => syncTaskToGitHub(task, { createIfMissing: true })}
          onSelectFeedback={setSelectedFeedbackId}
        />
      )}
      <PlanningTaskViewRenderer controller={controller} />
    </section>
  );
}
