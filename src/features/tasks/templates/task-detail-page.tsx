"use client";

import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { GitHubConnectionStatus } from "@/features/planning/molecules/github-connection-status";
import { TaskDetailHeader } from "@/features/tasks/molecules/task-detail-header";
import { NewTaskDialog } from "@/features/tasks/organisms/new-task-dialog";
import { TaskDetailSurface } from "@/features/tasks/organisms/task-detail-surface";
import { useTaskDetailWorkflow } from "@/features/tasks/hooks/use-task-detail-workflow";
import type { AuthenticatedProfile, Milestone, Package, PlanningHeaderData, Profile, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskRelation } from "@/lib/types";

type Props = {
  task: Task;
  pack?: Package;
  packages: Package[];
  sprint?: Sprint;
  subIssues: Task[];
  comments: TaskComment[];
  externalComments: TaskExternalComment[];
  activities: TaskActivity[];
  blockers: TaskBlocker[];
  taskRelations: TaskRelation[];
  allTasks: Task[];
  profiles: Profile[];
  sprints: Sprint[];
  milestones: Milestone[];
  headerData: PlanningHeaderData;
  source: "seed" | "supabase";
  commentImportNotice?: string;
  currentProfile?: AuthenticatedProfile | null;
};

export function TaskDetailPage({
  task,
  pack,
  packages,
  sprint,
  subIssues,
  comments,
  externalComments,
  activities,
  blockers,
  taskRelations,
  allTasks,
  profiles,
  sprints,
  milestones,
  headerData,
  source,
  commentImportNotice = "",
  currentProfile = null,
}: Props) {
  const workflow = useTaskDetailWorkflow({
    task,
    pack,
    packages,
    sprint,
    subIssues,
    comments,
    externalComments,
    activities,
    blockers,
    taskRelations,
    allTasks,
    profiles,
    sprints,
    milestones,
    source,
    commentImportNotice,
    initialCurrentProfile: currentProfile,
  });

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 lg:pl-16">
      <AppSidebar activeWorkspace="planning" source={source} currentPlatformRole={workflow.currentProfile?.platformRole || ""} />
      <TaskDetailHeader
        title={workflow.taskSnapshot.title}
        headerData={headerData}
        actions={(
          <GitHubConnectionStatus
            authenticated={source === "supabase"}
            available={workflow.githubAppConnected}
            failed={workflow.githubReconnectFailed}
            busy={workflow.isPending}
            onReconnect={workflow.reconnectGitHub}
          />
        )}
      />

      <div className="mx-auto max-w-7xl px-6 py-6">
        <TaskDetailSurface
          task={workflow.taskSnapshot}
          pack={pack}
          comments={workflow.taskComments}
          externalComments={workflow.taskExternalComments}
          activities={workflow.taskActivities}
          blockers={workflow.taskBlockers}
          subIssues={workflow.taskSubIssues}
          teamProfiles={profiles}
          packages={packages}
          sprints={sprints}
          milestones={milestones}
          allTasks={[...allTasks.filter((item) => item.id !== task.id), workflow.taskSnapshot]}
          relations={workflow.relations}
          currentProfile={workflow.currentProfile}
          source={source}
          pending={workflow.isPending}
          error={workflow.error}
          commentImportNotice={workflow.localCommentImportNotice}
          commentImportPending={workflow.githubCommentImportPending}
          githubAppConnected={workflow.githubAppConnected}
          onUpdate={workflow.updateTask}
          onAddComment={workflow.addComment}
          onUploadAttachment={workflow.uploadAttachment}
          onImportGitHubComments={() => workflow.importGitHubComments()}
          onReportBlocker={workflow.reportBlocker}
          onCreateSubIssue={() => workflow.setSubIssueDialogOpen(true)}
          onSyncGitHub={workflow.syncGitHub}
          onOpenReview={workflow.openReview}
          onDelete={workflow.deleteTask}
          onAddRelation={workflow.addRelation}
          onRemoveRelation={workflow.removeRelation}
        />
      </div>

      {workflow.subIssueDialogOpen && (
        <NewTaskDialog
          defaults={{
            taskType: "sub_issue",
            parentTaskId: task.id,
            milestoneId: workflow.taskSnapshot.milestoneId,
            packageId: workflow.taskSnapshot.packageId,
            assignee: workflow.taskSnapshot.assigneeId || workflow.taskSnapshot.assignee,
            status: "Offen",
          }}
          data={{ milestones, packages, profiles, sprints, tasks: allTasks }}
          pending={workflow.isPending}
          onClose={() => workflow.setSubIssueDialogOpen(false)}
          onCreate={workflow.createSubIssue}
        />
      )}
    </main>
  );
}
