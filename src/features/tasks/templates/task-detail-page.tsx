"use client";

import { TaskGitHubSyncNotice } from "@/features/tasks/molecules/task-github-sync-notice";
import { hasGitHubIssue } from "@/lib/platform";

import { TaskReviewOperationNotice } from "@/features/reviews/molecules/task-review-operation-notice";

import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type MouseEvent } from "react";
import { usePlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { PlanningBusinessStateContext } from "@/features/planning/hooks/use-planning-business-state";
import { useAdministratorAccessController } from "@/features/administrator-access/hooks/use-administrator-access-controller";
import type { AdministratorAccessSnapshot } from "@/features/administrator-access/model/administrator-access";
import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { PlanningOverlayLayer } from "@/features/planning/organisms/planning-overlay-layer";
import { useTaskDiscardGuard } from "@/features/tasks/hooks/use-task-discard-guard";
import { projectGitHubSyncQueue } from "@/features/tasks/model/github-sync-queue";
import { ApplicationHeader } from "@/features/application-shell/organisms/application-header";
import { safeTaskDetailReturnTo } from "@/features/tasks/model/task-detail-return-navigation";
import { TaskDiscardChangesDialog } from "@/features/tasks/molecules/task-discard-changes-dialog";
import { TaskGitHubSyncQueue } from "@/features/tasks/organisms/task-github-sync-queue";
import { TaskDetailSurface } from "@/features/tasks/organisms/task-detail-surface";
import { clearTaskReviewDraft } from "@/features/reviews/hooks/use-task-review-draft";
import { taskDetailModelToPlanningShellState } from "@/features/tasks/model/task-detail-planning-shell-projection";
import { initiativeForPlanningItem } from "@/features/planning/model/planning-app-model";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
import { isLocalLoginSimulationEnabled } from "@/lib/local-development-auth";
import type { AuthenticatedProfile, PlanningHeaderData } from "@/lib/types";

type Props = {
  taskId: string;
  initialModel: TaskDetailModel;
  headerData: PlanningHeaderData;
  source: "supabase";
  authRequired?: boolean;
  initialAuthUser?: User | null;
  initialCurrentProfile?: AuthenticatedProfile | null;
  initialAdministratorAccess?: AdministratorAccessSnapshot;
  initialDetailDataError?: string;
  initialCommentTarget?: string;
  returnHref?: string;
  returnLabel?: string;
};

export function TaskDetailPage({
  taskId,
  initialModel,
  headerData,
  source,
  authRequired = false,
  initialAuthUser = null,
  initialCurrentProfile = null,
  initialAdministratorAccess,
  initialDetailDataError = "",
  initialCommentTarget = "",
  returnHref = "/planning",
  returnLabel = "Zur Planung",
}: Props) {
  const router = useRouter();
  const [overviewDirty, setOverviewDirty] = useState(false);
  const discardGuard = useTaskDiscardGuard(overviewDirty);
  const initialData = useMemo(() => taskDetailModelToPlanningShellState(initialModel), [initialModel]);
  const administratorAccessController = useAdministratorAccessController({
    initialAccess: initialAdministratorAccess,
    platformRole: initialCurrentProfile?.platformRole || null,
  });
  const controller = usePlanningAppController({
    initialData,
    initialHeaderData: headerData,
    initialWorkspace: "planning",
    source,
    authRequired,
    initialAuthUser,
    initialCurrentProfile,
    initialProtectedDataLoaded: Boolean(initialAuthUser),
    operationalCorrection: administratorAccessController.authority.capabilities.operationalCorrection,
  });
  const task = controller.data.tasks.find((item) => item.id === taskId) || null;

  const navigateApproved = (href: string) => {
    controller.setMobileNavOpen(false);
    router.push(href);
  };
  const navigate = (href: string) => discardGuard.request(() => navigateApproved(href));
  const safeReturnHref = safeTaskDetailReturnTo(returnHref) || "/planning";
  const safeReturnLabel = safeReturnHref === "/planning" ? "Zur Planung" : returnLabel;
  const requestReturnNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(safeReturnHref);
  };

  if (!task) return <div role="status" className="min-h-screen bg-slate-50" aria-label="Aufgabendetails werden geladen" />;

  const currentInitiative = initiativeForPlanningItem(controller.data.tasks, task);
  const selectedRelations = controller.data.taskRelations.filter((relation) => relation.taskId === task.id || relation.relatedTaskId === task.id);
  const githubSyncQueue = projectGitHubSyncQueue(controller.data.tasks, controller.data.taskComments);
  const discardChanges = () => {
    if (task.reviewStatus === "requested") {
      clearTaskReviewDraft(task.id, task.reviewRequestedAt || "", controller.currentProfile?.id || "");
    }
    discardGuard.discard();
  };

  return (
    <PlanningBusinessStateContext.Provider value={controller.planningState}><main className="app-sidebar-main min-h-screen bg-white text-slate-950">
      <AppSidebar
        activeWorkspace="planning"
        source={source}
        currentPlatformRole={controller.currentProfile?.platformRole || ""}
        canAccessAdministration={administratorAccessController.authority.capabilities.manageAdministratorEligibility}
        mobileOpen={controller.mobileNavOpen}
        onMobileClose={() => controller.setMobileNavOpen(false)}
        onRequestNavigation={navigate}
      />
      <ApplicationHeader
        area={{ title: "Planung", heading: false }}
        navigation={{ mobileNavOpen: controller.mobileNavOpen, openMobileNav: () => controller.setMobileNavOpen(true), navigate: navigateApproved, requestNavigation: discardGuard.request }}
        lifecycle={{
          planningState: controller.planningState,
          enabled: Boolean(controller.authUser) && controller.protectedDataLoaded,
          profiles: controller.data.profiles,
          account: controller.authAvailable ? {
            user: controller.authUser, busy: controller.authBusy, onSignIn: () => discardGuard.request(() => { void controller.signIn(); }), onSignOut: controller.signOut,
            administratorAccess: administratorAccessController.administratorAccess,
            administratorAccessBusy: administratorAccessController.busy,
            administratorRemainingSeconds: administratorAccessController.remainingSeconds,
            canOpenAdministration: administratorAccessController.authority.capabilities.manageAdministratorEligibility,
            onActivateAdministrator: () => void administratorAccessController.activate(),
            onEndAdministrator: () => void administratorAccessController.end(),
          } : undefined,
          github: { count: githubSyncQueue.count, failedCount: githubSyncQueue.failedCount, installationAvailable: controller.githubInstallationAvailable, localMode: isLocalLoginSimulationEnabled(), connectionState: controller.githubConnectionState, open: controller.githubSyncQueueOpen, onOpen: () => controller.setGithubSyncQueueOpen(true) },
        }}
        context={(
          <Link href={safeReturnHref} onClick={requestReturnNavigation} className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500">
            <ArrowLeft size={16} aria-hidden="true" />{safeReturnLabel}
          </Link>
        )}
      />

      <div className="mx-auto max-w-[1392px] px-6 py-6 sm:px-8">
        {controller.planningState.taskGitHubSync(task.id)?<TaskGitHubSyncNotice view={controller.planningState.taskGitHubSync(task.id)!} onCheck={()=>{void controller.planningState.checkTaskGitHubSync(task.id);}} onRetry={()=>controller.syncTaskToGitHub(task,{createIfMissing:!hasGitHubIssue(task)})}/>:null}
        {controller.planningState.taskReviewOperations(task.id).map(operation=><TaskReviewOperationNotice profiles={controller.data.profiles} key={operation.id} operation={operation} onCheck={id=>{void controller.planningState.checkTaskReview(id);}} />)}
        <TaskDetailSurface
          surface="page"
          task={task}
          comments={controller.data.taskComments.filter((comment) => comment.taskId === task.id)}
          externalComments={controller.data.taskExternalComments.filter((comment) => comment.taskId === task.id)}
          activities={controller.data.taskActivity.filter((activity) => activity.taskId === task.id)}
          reviews={controller.data.taskReviews.filter((review) => review.taskId === task.id)}
          blockers={controller.data.taskBlockers.filter((blocker) => blocker.taskId === task.id)}
          subIssues={controller.data.tasks.filter((item) => item.parentTaskId === task.id)}
          teamProfiles={controller.data.profiles}
          sprints={controller.data.sprints}
          initiative={currentInitiative}
          allTasks={controller.data.tasks}
          relations={selectedRelations}
          currentProfile={controller.currentProfile}
          operationalCorrection={controller.canCorrectOperationally}
          pending={controller.isPending}
          error={controller.saveError}
          detailDataError={initialDetailDataError}
          requestedCommentTarget={initialCommentTarget}
          onOverviewDirtyChange={setOverviewDirty}
          onRequestDiscardAction={discardGuard.request}
          commentImportNotice={controller.commentImportNotice}
          commentImportPending={controller.commentImportPendingTaskIds.has(task.id)}
          githubInstallationAvailable={controller.githubInstallationAvailable}
          taskSaves={controller.planningState.taskSaves(task.id)}
          relationshipChanges={controller.planningState.taskRelationshipChanges(task.id)}
          onCheckRelationshipChange={changeId => { void controller.planningState.checkTaskRelationshipChange(changeId); }}
          attachmentUploads={controller.planningState.taskAttachmentUploads(task.id)}
          onCheckAttachmentUpload={id => { void controller.planningState.checkTaskAttachmentUpload(id); }}
          githubImport={controller.planningState.taskGitHubImport(task.id)}
          externalCommentCompleteness={controller.planningState.taskGitHubComments(task.id).completeness}
          onCheckGitHubImport={() => { void controller.planningState.checkTaskGitHubImport(task.id); }}
          commentCreations={controller.planningState.taskCommentCreations(task.id)}
          commentCompleteness={controller.planningState.taskComments(task.id).completeness}
          onCheckCommentCreation={id => { void controller.planningState.checkTaskCommentCreation(id); }}
          blockerReports={controller.planningState.taskBlockerReports(task.id)}
          onCheckBlockerReport={id => { void controller.planningState.checkTaskBlockerReport(id); }}
          onCheckTaskSave={() => controller.planningState.checkTaskSave(task.id)}
          onBeginEdit={() => controller.beginTaskEdit(task)}
          onUpdate={(patch, options) => controller.updateTask(task, patch, options)}
          onAddComment={(comment) => controller.addTaskComment(task, comment)}
          onUploadAttachment={(file) => controller.uploadTaskAttachment(task, file)}
          onImportGitHubComments={() => controller.importGitHubComments(task)}
          onReportBlocker={(payload) => controller.reportTaskBlocker(task, payload)}
          onCreateSubIssue={() => controller.setTaskDialogDefaults({
            taskType: task.taskType === "epic"
              ? "initiative"
              : task.taskType === "initiative"
                ? "deliverable"
                : "sub_issue",
            parentTaskId: task.id,
            assignee: controller.currentProfile?.id || "",
            status: "Offen",
          })}
          onOpenTask={controller.openTaskPanel}
          onOpenHierarchyTask={(parentTaskId) => router.push(`/tasks/${encodeURIComponent(parentTaskId)}`)}
          onSyncGitHub={(options) => controller.syncTaskToGitHub(task, options)}
          onReview={controller.reviewTask}
          onReopenReview={controller.reopenReviewTask}
          onWithdrawReview={controller.withdrawReviewTask}
          onWithdraw={(reason) => {
            if (controller.withdrawTask(task, reason)) router.replace("/planning");
          }}
          onAddRelation={(payload, basis) => controller.addTaskRelation(basis || task, payload)}
          onRemoveRelation={(relation) => controller.removeTaskRelation(task, relation)}
          onDecideApproval={(action, note, basis) => controller.decideTaskApproval(basis || task, action, note)}
        />
      </div>

      <TaskGitHubSyncQueue
        open={controller.githubSyncQueueOpen}
        tasks={controller.data.tasks}
        comments={controller.data.taskComments}
        pending={controller.isPending}
        githubInstallationAvailable={controller.githubInstallationAvailable}
        githubUserConnected={controller.githubUserConnected}
        githubConnectionState={controller.githubConnectionState}
        waitingGitHubCommentCount={controller.waitingGitHubCommentCount}
        githubReauthFailed={controller.githubReauthFailed}
        authBusy={controller.authBusy}
        localMode={isLocalLoginSimulationEnabled()}
        notice={controller.githubSyncNotice}
        onClose={() => controller.setGithubSyncQueueOpen(false)}
        onOpenTask={controller.openTaskPanel}
        onReconnect={() => discardGuard.request(() => { void controller.signIn({ githubReconnect: true, clearReconnectGuard: true }); })}
        syncOperations={controller.planningState.taskGitHubSyncs()}
        onCheckSync={id=>{void controller.planningState.checkTaskGitHubSync(id);}}
        onSyncLinkedGitHubTasks={controller.syncLinkedGitHubTasks}
        onSyncTaskToGitHub={controller.syncTaskToGitHub}
      />
      <PlanningOverlayLayer controller={controller} />
      <TaskDiscardChangesDialog
        open={discardGuard.open}
        busy={discardGuard.busy}
        onDiscard={discardChanges}
        onKeepEditing={discardGuard.keepEditing}
      />
    </main></PlanningBusinessStateContext.Provider>
  );
}
