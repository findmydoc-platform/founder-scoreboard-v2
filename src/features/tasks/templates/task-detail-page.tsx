"use client";

import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { usePlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { PlanningOverlayLayer } from "@/features/planning/organisms/planning-overlay-layer";
import { useTaskDiscardGuard } from "@/features/tasks/hooks/use-task-discard-guard";
import { projectGitHubSyncQueue } from "@/features/tasks/model/github-sync-queue";
import { GitHubSyncTrigger } from "@/features/tasks/molecules/github-sync-trigger";
import { TaskDetailHeader } from "@/features/tasks/molecules/task-detail-header";
import { TaskDiscardChangesDialog } from "@/features/tasks/molecules/task-discard-changes-dialog";
import { TaskGitHubSyncQueue } from "@/features/tasks/organisms/task-github-sync-queue";
import { TaskDetailSurface } from "@/features/tasks/organisms/task-detail-surface";
import type { AuthenticatedProfile, PlanningData, PlanningHeaderData } from "@/lib/types";

type Props = {
  taskId: string;
  initialData: PlanningData;
  headerData: PlanningHeaderData;
  source: "seed" | "supabase";
  authRequired?: boolean;
  initialAuthUser?: User | null;
  initialCurrentProfile?: AuthenticatedProfile | null;
  initialDetailDataError?: string;
};

export function TaskDetailPage({
  taskId,
  initialData,
  headerData,
  source,
  authRequired = false,
  initialAuthUser = null,
  initialCurrentProfile = null,
  initialDetailDataError = "",
}: Props) {
  const router = useRouter();
  const [overviewDirty, setOverviewDirty] = useState(false);
  const discardGuard = useTaskDiscardGuard(overviewDirty);
  const controller = usePlanningAppController({
    initialData,
    initialHeaderData: headerData,
    initialWorkspace: "planning",
    source,
    authRequired,
    initialAuthUser,
    initialCurrentProfile,
    initialProtectedDataLoaded: source === "seed" || Boolean(initialAuthUser),
  });
  const task = controller.data.tasks.find((item) => item.id === taskId) || null;

  if (!task) return <div className="min-h-screen bg-slate-50" aria-label="Aufgabendetails werden geladen" />;

  const currentPackage = controller.data.packages.find((pack) => pack.id === task.packageId);
  const selectedRelations = controller.data.taskRelations.filter((relation) => relation.taskId === task.id || relation.relatedTaskId === task.id);
  const githubSyncQueue = projectGitHubSyncQueue(controller.data.tasks, controller.data.taskComments);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 lg:pl-16">
      <AppSidebar
        activeWorkspace="planning"
        source={source}
        currentPlatformRole={controller.currentProfile?.platformRole || ""}
        onRequestNavigation={(href) => discardGuard.request(() => router.push(href))}
      />
      <TaskDetailHeader
        title={task.title}
        headerData={controller.headerData}
        notificationsOpen={controller.showNotifications}
        onToggleNotifications={() => controller.showNotifications ? controller.setShowNotifications(false) : controller.openNotificationInbox()}
        onOpenNotification={controller.openNotification}
        onDismissNotification={controller.dismissNotification}
        onBack={() => discardGuard.request(() => router.push("/planning"))}
        actions={(
          <GitHubSyncTrigger
            count={githubSyncQueue.count}
            failedCount={githubSyncQueue.failedCount}
            installationAvailable={controller.githubInstallationAvailable}
            localMode={source === "seed"}
            connectionState={controller.githubConnectionState}
            open={controller.githubSyncQueueOpen}
            onOpen={() => controller.setGithubSyncQueueOpen(true)}
          />
        )}
      />

      <div className="mx-auto max-w-7xl px-6 py-6">
        <TaskDetailSurface
          surface="page"
          task={task}
          pack={currentPackage}
          comments={controller.data.taskComments.filter((comment) => comment.taskId === task.id)}
          externalComments={controller.data.taskExternalComments.filter((comment) => comment.taskId === task.id)}
          activities={controller.data.taskActivity.filter((activity) => activity.taskId === task.id)}
          blockers={controller.data.taskBlockers.filter((blocker) => blocker.taskId === task.id)}
          subIssues={controller.data.tasks.filter((item) => item.parentTaskId === task.id)}
          teamProfiles={controller.data.profiles}
          packages={controller.data.packages}
          sprints={controller.data.sprints}
          milestones={controller.data.milestones}
          allTasks={controller.data.tasks}
          relations={selectedRelations}
          currentProfile={controller.currentProfile}
          source={source}
          pending={controller.isPending}
          error={controller.saveError}
          detailDataError={initialDetailDataError}
          onOverviewDirtyChange={setOverviewDirty}
          onRequestDiscardAction={discardGuard.request}
          commentImportNotice={controller.commentImportNotice}
          commentImportPending={controller.commentImportPendingTaskIds.has(task.id)}
          githubInstallationAvailable={controller.githubInstallationAvailable}
          onUpdate={(patch) => controller.updateTask(task, patch)}
          onAddComment={(comment) => controller.addTaskComment(task, comment)}
          onUploadAttachment={(file) => controller.uploadTaskAttachment(task, file)}
          onImportGitHubComments={() => controller.importGitHubComments(task)}
          onReportBlocker={(payload) => controller.reportTaskBlocker(task, payload)}
          onCreateSubIssue={() => controller.setTaskDialogDefaults({ taskType: "sub_issue", parentTaskId: task.id, milestoneId: task.milestoneId, packageId: task.packageId, assignee: task.assigneeId || task.assignee, status: "Offen" })}
          onOpenTask={controller.openTaskPanel}
          onSyncGitHub={(options) => controller.syncTaskToGitHub(task, options)}
          onOpenReview={() => controller.openReviewSheet(task)}
          onWithdraw={(reason) => {
            if (controller.withdrawTask(task, reason)) router.replace("/planning");
          }}
          onAddRelation={(payload) => controller.addTaskRelation(task, payload)}
          onRemoveRelation={(relation) => controller.removeTaskRelation(task, relation)}
          onDecideApproval={(action, note) => controller.decideTaskApproval(task, action, note)}
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
        localMode={source === "seed"}
        notice={controller.githubSyncNotice}
        onClose={() => controller.setGithubSyncQueueOpen(false)}
        onOpenTask={controller.openTaskPanel}
        onReconnect={() => controller.signIn({ githubReconnect: true, clearReconnectGuard: true })}
        onSyncLinkedGitHubTasks={controller.syncLinkedGitHubTasks}
        onSyncTaskToGitHub={controller.syncTaskToGitHub}
      />
      <PlanningOverlayLayer controller={controller} />
      <TaskDiscardChangesDialog
        open={discardGuard.open}
        onDiscard={discardGuard.discard}
        onKeepEditing={discardGuard.keepEditing}
      />
    </main>
  );
}
