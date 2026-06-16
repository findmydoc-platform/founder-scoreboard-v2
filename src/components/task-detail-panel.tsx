"use client";

import { useState } from "react";
import { TaskCommentThread } from "@/components/task-comment-thread";
import { TaskDetailPanelBlockerSection } from "@/components/task-detail-panel-blocker-section";
import { TaskDetailPanelBriefSection } from "@/components/task-detail-panel-brief-section";
import { TaskDetailPanelContextSection } from "@/components/task-detail-panel-context-section";
import { TaskDetailPanelDependenciesSection } from "@/components/task-detail-panel-dependencies-section";
import { TaskDetailPanelHeader } from "@/components/task-detail-panel-header";
import { TaskDetailPanelNotesSection } from "@/components/task-detail-panel-notes-section";
import { TaskDetailPanelSidebar } from "@/components/task-detail-panel-sidebar";
import { TaskDetailPanelSubIssuesSection } from "@/components/task-detail-panel-sub-issues-section";
import { taskOwnerLabel } from "@/lib/display";
import { taskRelationsFor } from "@/lib/platform";
import type { DecisionTaskLink, Milestone, Package, PlanningData, Profile, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskFocusItem, TaskRelation, TaskRelationType } from "@/lib/types";

function relationshipRows(task: Task, tasks: Task[], relations: TaskRelation[]) {
  const taskById = new Map(tasks.map((item) => [item.id, item]));
  const grouped = taskRelationsFor(task.id, relations);
  const toRow = (relation: TaskRelation, direction: "related" | "inverse") => {
    const otherId = direction === "inverse" ? relation.taskId : relation.relatedTaskId;
    return { relation, task: taskById.get(otherId) };
  };

  return {
    waitsOn: grouped.waitsOn.map((relation) => toRow(relation, "related")),
    blocks: grouped.blocks.map((relation) => relation.taskId === task.id ? toRow(relation, "related") : toRow(relation, "inverse")),
    related: grouped.related.map((relation) => relation.taskId === task.id ? toRow(relation, "related") : toRow(relation, "inverse")),
  };
}
export function TaskDetailPanel({
  task,
  pack,
  comments,
  externalComments,
  activities,
  commentImportNotice,
  commentImportPending,
  blockers,
  subIssues,
  teamProfiles,
  packages,
  sprints,
  milestones,
  decisions,
  decisionTaskLinks,
  focusItems,
  canManageTaskMeta,
  canChangeTaskStatus = canManageTaskMeta,
  allTasks,
  relations,
  pending,
  githubProviderTokenAvailable,
  onClose,
  onUpdate,
  onAddComment,
  onUploadAttachment,
  onImportGitHubComments,
  onReportBlocker,
  onCreateSubIssue,
  onReconnectGitHub,
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
  commentImportNotice: string;
  commentImportPending: boolean;
  blockers: TaskBlocker[];
  subIssues: Task[];
  teamProfiles: Profile[];
  packages: Package[];
  sprints: Sprint[];
  milestones: Milestone[];
  decisions: PlanningData["decisions"];
  decisionTaskLinks: DecisionTaskLink[];
  focusItems: TaskFocusItem[];
  canManageTaskMeta: boolean;
  canChangeTaskStatus?: boolean;
  allTasks: Task[];
  relations: TaskRelation[];
  pending: boolean;
  githubProviderTokenAvailable: boolean;
  onClose: () => void;
  onUpdate: (patch: Partial<Task>) => void;
  onAddComment: (comment: string) => void;
  onUploadAttachment: (file: File) => Promise<string>;
  onImportGitHubComments: () => void;
  onReportBlocker: (payload: { reason: string; impact: string; needsHelpFrom: string }) => void;
  onCreateSubIssue: () => void;
  onReconnectGitHub: () => void;
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
  const linkedDecisions = decisionTaskLinks
    .filter((link) => link.taskId === task.id)
    .map((link) => ({ link, decision: decisions.find((decision) => decision.id === link.decisionId) }))
    .filter((item) => item.decision);
  const linkedFocusItems = focusItems
    .filter((item) => item.taskId === task.id)
    .sort((left, right) => right.focusDate.localeCompare(left.focusDate) || left.position - right.position)
    .slice(0, 5);
  const relationshipGroups = relationshipRows(task, allTasks, relations);
  const relationTargetOptions = allTasks
    .filter((item) => item.id !== task.id && item.taskType !== "sub_issue")
    .map((item) => ({ value: item.id, label: `${item.title} · ${taskOwnerLabel(item)}` }));

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
            <TaskDetailPanelContextSection linkedFocusItems={linkedFocusItems} linkedDecisions={linkedDecisions} profileName={profileName} />
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
            canChangeTaskStatus={canChangeTaskStatus}
            pending={pending}
            githubProviderTokenAvailable={githubProviderTokenAvailable}
            onUpdate={onUpdate}
            onReconnectGitHub={onReconnectGitHub}
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
