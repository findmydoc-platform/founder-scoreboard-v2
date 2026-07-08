"use client";

import { useState } from "react";
import { TaskDetailPanelBlockerSection } from "@/features/tasks/molecules/task-detail-panel-blocker-section";
import { TaskDetailPanelBriefSection } from "@/features/tasks/molecules/task-detail-panel-brief-section";
import { TaskDetailPanelDependenciesSection } from "@/features/tasks/molecules/task-detail-panel-dependencies-section";
import { TaskDetailPanelHeader } from "@/features/tasks/molecules/task-detail-panel-header";
import { TaskDetailPanelNotesSection } from "@/features/tasks/molecules/task-detail-panel-notes-section";
import { TaskDetailPanelSubIssuesSection } from "@/features/tasks/molecules/task-detail-panel-sub-issues-section";
import { TaskCommentThread } from "@/features/tasks/organisms/task-comment-thread";
import { TaskDetailPanelSidebar } from "@/features/tasks/organisms/task-detail-panel-sidebar";
import { buildTaskRelationshipRows, relationTargetOptionsForTask } from "@/features/tasks/model/task-detail-state";
import type { Milestone, Package, Profile, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskRelation, TaskRelationType } from "@/lib/types";
export function TaskDetailPanel({
  task,
  pack,
  comments,
  externalComments,
  activities,
  detailDataError,
  detailDataLoading,
  commentImportNotice,
  commentImportPending,
  blockers,
  subIssues,
  teamProfiles,
  packages,
  sprints,
  milestones,
  canManageTaskMeta,
  canManageReviewOwner,
  canChangeTaskStatus = canManageTaskMeta,
  allTasks,
  relations,
  pending,
  githubAppConnected,
  onClose,
  onUpdate,
  onAddComment,
  onUploadAttachment,
  onImportGitHubComments,
  onReportBlocker,
  onCreateSubIssue,
  onSyncGitHub,
  onOpenReview,
  onDelete,
  onAddRelation,
  onRemoveRelation,
}: {
  task: Task;
  pack?: Package;
  comments: TaskComment[];
  externalComments: TaskExternalComment[];
  activities: TaskActivity[];
  detailDataError: string;
  detailDataLoading: boolean;
  commentImportNotice: string;
  commentImportPending: boolean;
  blockers: TaskBlocker[];
  subIssues: Task[];
  teamProfiles: Profile[];
  packages: Package[];
  sprints: Sprint[];
  milestones: Milestone[];
  canManageTaskMeta: boolean;
  canManageReviewOwner: boolean;
  canChangeTaskStatus?: boolean;
  allTasks: Task[];
  relations: TaskRelation[];
  pending: boolean;
  githubAppConnected: boolean;
  onClose: () => void;
  onUpdate: (patch: Partial<Task>) => void;
  onAddComment: (comment: string) => void;
  onUploadAttachment: (file: File) => Promise<string>;
  onImportGitHubComments: () => void;
  onReportBlocker: (payload: { reason: string; impact: string; needsHelpFrom: string }) => void;
  onCreateSubIssue: () => void;
  onSyncGitHub: (options?: { createIfMissing?: boolean }) => void;
  onOpenReview: () => void;
  onDelete: () => void;
  onAddRelation: (payload: { relationType: TaskRelationType; relatedTaskId: string; note: string }) => void;
  onRemoveRelation: (relation: TaskRelation) => void;
}) {
  const [blockerDraft, setBlockerDraft] = useState({ reason: "", impact: "", needsHelpFrom: "" });
  const [relationDraft, setRelationDraft] = useState<{ relationType: TaskRelationType; relatedTaskId: string; note: string }>({
    relationType: "blocked_by",
    relatedTaskId: "",
    note: "",
  });
  const profileName = (profileId: string) => teamProfiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";
  const relationshipGroups = buildTaskRelationshipRows(task, allTasks, relations);
  const relationTargetOptions = relationTargetOptionsForTask(task, allTasks);

  return (
    <>
    <button
      type="button"
      className="fixed inset-0 z-30 cursor-default bg-slate-950/[0.03]"
      aria-label="Detailpanel schließen"
      onClick={onClose}
    />
    <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-[920px] overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
      <TaskDetailPanelHeader task={task} onClose={onClose} />
      <div className="p-5">
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <main className="grid min-w-0 gap-4">
            <TaskDetailPanelBriefSection task={task} onUpdate={onUpdate} />
            <TaskDetailPanelDependenciesSection
              task={task}
              relationshipGroups={relationshipGroups}
              relationDraft={relationDraft}
              relationTargetOptions={relationTargetOptions}
              canManageTaskMeta={canManageTaskMeta}
              pending={pending}
              onRelationDraftChange={(patch) => setRelationDraft((current) => ({ ...current, ...patch }))}
              onAddRelation={(draft) => {
                onAddRelation(draft);
                setRelationDraft({ relationType: "blocked_by", relatedTaskId: "", note: "" });
              }}
              onRemoveRelation={onRemoveRelation}
            />
            <TaskDetailPanelSubIssuesSection subIssues={subIssues} onCreateSubIssue={onCreateSubIssue} />
            {(detailDataLoading || detailDataError) && (
              <div className={detailDataError ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" : "rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600"}>
                {detailDataError || "Kommentare, Blocker und Verlauf werden geladen..."}
              </div>
            )}
            <TaskDetailPanelBlockerSection
              blockers={blockers}
              blockerDraft={blockerDraft}
              pending={pending}
              profileName={profileName}
              onBlockerDraftChange={(patch) => setBlockerDraft((current) => ({ ...current, ...patch }))}
              onReportBlocker={(draft) => {
                onReportBlocker(draft);
                setBlockerDraft({ reason: "", impact: "", needsHelpFrom: "" });
              }}
            />

            <TaskDetailPanelNotesSection task={task} pending={pending} onUpdate={onUpdate} />
          </main>

          <TaskDetailPanelSidebar
            task={task}
            pack={pack}
            teamProfiles={teamProfiles}
            packages={packages}
            sprints={sprints}
            milestones={milestones}
            canManageTaskMeta={canManageTaskMeta}
            canManageReviewOwner={canManageReviewOwner}
            canChangeTaskStatus={canChangeTaskStatus}
            pending={pending}
            githubAppConnected={githubAppConnected}
            onUpdate={onUpdate}
            onSyncGitHub={onSyncGitHub}
            onOpenReview={onOpenReview}
            onDelete={onDelete}
          />
        </div>

        <div className="mt-5 min-w-0">
          <TaskCommentThread
            comments={comments}
            externalComments={externalComments}
            activities={activities}
            notice={commentImportNotice}
            profiles={teamProfiles}
            pending={pending}
            importPending={commentImportPending}
            onImportGitHubComments={onImportGitHubComments}
            onUploadAttachment={onUploadAttachment}
            onAddComment={onAddComment}
          />
        </div>
      </div>
    </aside>
    </>
  );
}
