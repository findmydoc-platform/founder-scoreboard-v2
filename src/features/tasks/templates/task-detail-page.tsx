"use client";

import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { usePlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { PlanningOverlayLayer } from "@/features/planning/organisms/planning-overlay-layer";
import { GitHubConnectionStatus } from "@/features/planning/molecules/github-connection-status";
import { TaskDetailHeader } from "@/features/tasks/molecules/task-detail-header";
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
};

export function TaskDetailPage({
  taskId,
  initialData,
  headerData,
  source,
  authRequired = false,
  initialAuthUser = null,
  initialCurrentProfile = null,
}: Props) {
  const router = useRouter();
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

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 lg:pl-16">
      <AppSidebar activeWorkspace="planning" source={source} currentPlatformRole={controller.currentProfile?.platformRole || ""} />
      <TaskDetailHeader
        title={task.title}
        headerData={controller.headerData}
        notificationsOpen={controller.showNotifications}
        onToggleNotifications={() => controller.showNotifications ? controller.setShowNotifications(false) : controller.openNotificationInbox()}
        onOpenNotification={controller.openNotification}
        onDismissNotification={controller.dismissNotification}
        actions={(
          <GitHubConnectionStatus
            authenticated={Boolean(controller.authUser)}
            installationAvailable={controller.githubInstallationAvailable}
            userConnected={controller.githubUserConnected}
            waitingCommentCount={controller.waitingGitHubCommentCount}
            failed={controller.githubReauthFailed}
            busy={controller.authBusy}
            state={controller.githubConnectionState}
            onReconnect={() => controller.signIn({ githubReconnect: true, clearReconnectGuard: true })}
          />
        )}
      />

      <div className="mx-auto max-w-7xl px-6 py-6">
        <TaskDetailSurface
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
          onDelete={() => {
            if (controller.deleteTask(task)) router.replace("/planning");
          }}
          onAddRelation={(payload) => controller.addTaskRelation(task, payload)}
          onRemoveRelation={(relation) => controller.removeTaskRelation(task, relation)}
          onDecideApproval={(action, note) => controller.decideTaskApproval(task, action, note)}
        />
      </div>

      <PlanningOverlayLayer controller={controller} />
    </main>
  );
}
