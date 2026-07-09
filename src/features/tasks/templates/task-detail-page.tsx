"use client";

import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import type { Milestone, Package, Profile, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskRelation } from "@/lib/types";
import { GitHubConnectionStatus } from "@/features/planning/molecules/github-connection-status";
import { TaskBlockerCard } from "@/features/tasks/molecules/task-blocker-card";
import { TaskBriefSection } from "@/features/tasks/molecules/task-brief-section";
import { TaskCommentThread } from "@/features/tasks/organisms/task-comment-thread";
import { TaskDetailHeader } from "@/features/tasks/molecules/task-detail-header";
import { TaskDetailsCard } from "@/features/tasks/organisms/task-details-card";
import { TaskEvidenceLinkSection } from "@/features/tasks/molecules/task-evidence-link-section";
import { TaskGitHubSyncCard } from "@/features/tasks/molecules/task-github-sync-card";
import { TaskRelationshipsSection } from "@/features/tasks/organisms/task-relationships-section";
import { TaskSubIssuesSection } from "@/features/tasks/molecules/task-sub-issues-section";
import { useTaskDetailWorkflow } from "@/features/tasks/hooks/use-task-detail-workflow";

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
  source: "seed" | "supabase";
  commentImportNotice?: string;
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
  source,
  commentImportNotice = "",
}: Props) {
  const {
    addComment,
    addRelation,
    briefEditing,
    currentRole,
    detailsDraft,
    detailsEditing,
    error,
    githubCommentImportPending,
    githubAppConnected,
    githubReconnectFailed,
    githubState,
    importGitHubComments,
    isPending,
    localCommentImportNotice,
    meta,
    reconnectGitHub,
    relationDraft,
    removeRelation,
    resetBriefDraft,
    resetDetailsDraft,
    saveBriefDraft,
    saveDetailsDraft,
    saveState,
    setBriefEditing,
    setDetailsDraft,
    setDetailsMilestone,
    setDetailsPackage,
    setEvidenceLink,
    setRelationDraft,
    startDetailsEditing,
    syncGitHub,
    taskActivities,
    taskComments,
    taskExternalComments,
    updateBriefDraft,
    updateChecklist,
    updateTask,
    uploadAttachment,
    viewModel,
  } = useTaskDetailWorkflow({
    task,
    pack,
    packages,
    sprint,
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
  });

  const {
    assigneeProfile,
    creatorProfile,
    currentSprint,
    currentMilestone,
    currentPackage,
    profileName,
    openBlockers,
    waitsOn,
    blocks,
    related,
    relationTargetOptions,
    canManageTaskMeta,
    canSyncExistingGitHubIssue,
  } = viewModel;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 lg:pl-16">
      <AppSidebar activeWorkspace="planning" source={source} />

      <TaskDetailHeader
        title={task.title}
        actions={(
          <GitHubConnectionStatus
            authenticated={source === "supabase"}
            available={githubAppConnected}
            failed={githubReconnectFailed}
            busy={isPending}
            onReconnect={reconnectGitHub}
          />
        )}
      />

      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid min-w-0 gap-5">
            <TaskBriefSection
              brief={meta}
              editing={briefEditing}
              onEdit={() => setBriefEditing(true)}
              onCancel={resetBriefDraft}
              onSave={saveBriefDraft}
              onBriefChange={updateBriefDraft}
              onChecklistChange={updateChecklist}
            >

              <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5">
                <TaskEvidenceLinkSection
                  evidenceLink={meta.evidenceLink}
                  onEvidenceLinkChange={setEvidenceLink}
                  onEvidenceLinkSave={() => updateTask({ evidenceLink: meta.evidenceLink })}
                />
                <TaskRelationshipsSection
                  task={task}
                  waitsOn={waitsOn}
                  blocks={blocks}
                  related={related}
                  dependsOn={meta.dependsOn}
                  relationDraft={relationDraft}
                  relationTargetOptions={relationTargetOptions}
                  canManageTaskMeta={canManageTaskMeta}
                  pending={isPending}
                  onRemoveRelation={removeRelation}
                  onDependsOnChange={(dependsOn) => updateBriefDraft({ dependsOn })}
                  onDependsOnSave={() => updateTask({ dependsOn: meta.dependsOn })}
                  onRelationDraftChange={(patch) => setRelationDraft((current) => ({ ...current, ...patch }))}
                  onAddRelation={addRelation}
                />
              </div>
            </TaskBriefSection>

            <TaskSubIssuesSection subIssues={subIssues} />

          </div>

          <aside className="grid content-start gap-5">
            <TaskDetailsCard
              task={task}
              meta={meta}
              detailsDraft={detailsDraft}
              creatorProfile={creatorProfile}
              assigneeProfile={assigneeProfile}
              currentPackage={currentPackage}
              currentSprint={currentSprint}
              currentMilestone={currentMilestone}
              canManageFinalTaskStatus={source === "seed" || currentRole === "ceo"}
              canManageTaskMeta={canManageTaskMeta}
              canManageReviewOwner={currentRole === "ceo"}
              detailsEditing={detailsEditing}
              pending={isPending}
              saveState={saveState}
              packages={packages}
              profiles={profiles}
              sprints={sprints}
              milestones={milestones}
              onStatusChange={(status) => updateTask({ status })}
              onDetailsDraftChange={setDetailsDraft}
              onDetailsPackageChange={setDetailsPackage}
              onDetailsMilestoneChange={setDetailsMilestone}
              onStartEditing={startDetailsEditing}
              onCancelEditing={resetDetailsDraft}
              onSaveDetails={saveDetailsDraft}
            />

            <TaskBlockerCard blockers={blockers} openBlockerCount={openBlockers.length} profileName={profileName} />

            <TaskGitHubSyncCard
              taskType={task.taskType}
              githubState={githubState}
              canSyncExistingGitHubIssue={canSyncExistingGitHubIssue}
              pending={isPending}
              githubAppConnected={githubAppConnected}
              onSyncGitHub={() => syncGitHub()}
              onCreateGitHubIssue={() => syncGitHub({ createIfMissing: true })}
            />
          </aside>
        </div>

        <div className="mt-5 min-w-0">
          <TaskCommentThread
            comments={taskComments}
            externalComments={taskExternalComments}
            activities={taskActivities}
            notice={localCommentImportNotice}
            profiles={profiles}
            pending={isPending}
            importPending={githubCommentImportPending}
            onImportGitHubComments={importGitHubComments}
            onUploadAttachment={uploadAttachment}
            title="Kommentare"
            description="Laufende Abstimmungen, Nachfragen und Updates zur Aufgabe."
            onAddComment={addComment}
          />
        </div>
        {error && <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
      </div>
    </main>
  );
}
