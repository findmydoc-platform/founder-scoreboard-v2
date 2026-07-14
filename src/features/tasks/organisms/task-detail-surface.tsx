"use client";

import { useTaskDetailController } from "@/features/tasks/hooks/use-task-detail-controller";
import {
  canApproveDeliverableApproval,
  canRejectDeliverableApproval,
  canReturnDeliverableForRevision,
} from "@/features/planning/model/approval-domain";
import { canWithdrawPlanningRoot } from "@/features/planning/model/planning-trash-contract";
import { TaskBriefSection } from "@/features/tasks/molecules/task-brief-section";
import { TaskDetailPanelBlockerSection } from "@/features/tasks/molecules/task-detail-panel-blocker-section";
import { TaskDetailPanelNotesSection } from "@/features/tasks/molecules/task-detail-panel-notes-section";
import { TaskDetailPanelSubIssuesSection } from "@/features/tasks/molecules/task-detail-panel-sub-issues-section";
import { TaskEvidenceLinkSection } from "@/features/tasks/molecules/task-evidence-link-section";
import { TaskCommentThread } from "@/features/tasks/organisms/task-comment-thread";
import { TaskDetailPanelSidebar } from "@/features/tasks/organisms/task-detail-panel-sidebar";
import { TaskRelationshipsSection } from "@/features/tasks/organisms/task-relationships-section";
import { buildTaskRelationshipRows, relationTargetOptionsForTask } from "@/features/tasks/model/task-detail-state";
import { taskRelationshipAccess } from "@/features/tasks/model/task-relationship-permissions";
import type { ApprovalDecisionAction, AuthenticatedProfile, Milestone, Package, Profile, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskRelation, TaskRelationType } from "@/lib/types";

type TaskDetailSurfaceProps = {
  task: Task;
  pack?: Package;
  comments: TaskComment[];
  externalComments: TaskExternalComment[];
  activities: TaskActivity[];
  blockers: TaskBlocker[];
  subIssues: Task[];
  teamProfiles: Profile[];
  packages: Package[];
  sprints: Sprint[];
  milestones: Milestone[];
  allTasks: Task[];
  relations: TaskRelation[];
  currentProfile?: Pick<AuthenticatedProfile, "id" | "name" | "platformRole"> | null;
  source: "seed" | "supabase";
  pending: boolean;
  error?: string;
  detailDataError?: string;
  detailDataLoading?: boolean;
  commentImportNotice?: string;
  commentImportPending?: boolean;
  githubInstallationAvailable: boolean;
  onUpdate: (patch: Partial<Task>) => void;
  onAddComment: (comment: string) => Promise<void> | void;
  onUploadAttachment: (file: File) => Promise<string>;
  onImportGitHubComments: () => void;
  onReportBlocker: (payload: { reason: string; impact: string; needsHelpFrom: string }) => void;
  onCreateSubIssue: () => void;
  onOpenTask: (taskId: string) => void;
  onSyncGitHub: (options?: { createIfMissing?: boolean }) => void;
  onOpenReview: () => void;
  onWithdraw: (reason: string) => void;
  onAddRelation: (payload: { relationType: TaskRelationType; relatedTaskId: string; note: string }) => void;
  onRemoveRelation: (relation: TaskRelation) => void;
  onDecideApproval: (action: ApprovalDecisionAction, note?: string) => void;
};

export function TaskDetailSurface({
  task,
  pack,
  comments,
  externalComments,
  activities,
  blockers,
  subIssues,
  teamProfiles,
  packages,
  sprints,
  milestones,
  allTasks,
  relations,
  currentProfile = null,
  source,
  pending,
  error = "",
  detailDataError = "",
  detailDataLoading = false,
  commentImportNotice = "",
  commentImportPending = false,
  githubInstallationAvailable,
  onUpdate,
  onAddComment,
  onUploadAttachment,
  onImportGitHubComments,
  onReportBlocker,
  onCreateSubIssue,
  onOpenTask,
  onSyncGitHub,
  onOpenReview,
  onWithdraw,
  onAddRelation,
  onRemoveRelation,
  onDecideApproval,
}: TaskDetailSurfaceProps) {
  const controller = useTaskDetailController({
    task,
    currentProfile,
    unrestricted: source === "seed",
    onUpdate,
  });
  const currentPackage = packages.find((item) => item.id === task.packageId) || pack;
  const relationshipGroups = buildTaskRelationshipRows(task, allTasks, relations);
  const relationshipAccess = taskRelationshipAccess({
    task,
    initiative: currentPackage,
    profile: currentProfile,
    unrestricted: source === "seed",
  });
  const relationTargetOptions = relationTargetOptionsForTask(task, allTasks);
  const profileName = (profileId: string) => teamProfiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";
  const canApprove = canApproveDeliverableApproval(task, currentPackage, currentProfile);
  const canReject = canRejectDeliverableApproval(task, currentPackage, currentProfile);
  const canReturnToDraft = canReturnDeliverableForRevision(task, currentPackage, currentProfile);
  const canWithdrawTask = task.taskType === "deliverable" && canWithdrawPlanningRoot({
    rootType: "deliverable",
    approvalStatus: task.approvalStatus,
    proposedById: task.proposedById,
  }, currentProfile, source === "seed");

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="grid min-w-0 gap-4">
          <TaskBriefSection
            brief={controller.briefDraft}
            canEdit={controller.permissions.canEditBrief}
            editing={controller.briefEditing}
            onEdit={controller.startBriefEditing}
            onCancel={controller.cancelBrief}
            onSave={controller.saveBrief}
            onBriefChange={(patch) => controller.setBriefDraft((current) => ({ ...current, ...patch }))}
            onChecklistChange={(patch) => {
              if (controller.permissions.canEditChecklist) onUpdate(patch);
            }}
          >
            <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5">
              <TaskEvidenceLinkSection
                canEdit={controller.permissions.canEditEvidence}
                evidenceLink={controller.evidenceDraft}
                pending={pending}
                onEvidenceLinkChange={controller.setEvidenceDraft}
                onEvidenceLinkSave={controller.saveEvidence}
              />
              <TaskRelationshipsSection
                task={task}
                waitsOn={relationshipGroups.waitsOn}
                blocks={relationshipGroups.blocks}
                related={relationshipGroups.related}
                dependsOn={controller.dependsOnDraft}
                relationDraft={controller.relationDraft}
                relationTargetOptions={relationTargetOptions}
                allowedRelationTypes={relationshipAccess.allowedRelationTypes}
                pending={pending}
                onOpenTask={onOpenTask}
                onRemoveRelation={onRemoveRelation}
                canRemoveRelation={relationshipAccess.canRemoveRelation}
                onDependsOnChange={controller.setDependsOnDraft}
                onDependsOnSave={controller.saveDependsOn}
                onRelationDraftChange={(patch) => controller.setRelationDraft((current) => ({ ...current, ...patch }))}
                onAddRelation={() => {
                  onAddRelation(controller.relationDraft);
                  controller.setRelationDraft({ relationType: "blocked_by", relatedTaskId: "", note: "" });
                }}
              />
            </div>
          </TaskBriefSection>

          <TaskDetailPanelSubIssuesSection
            canCreate={controller.permissions.canCreateSubIssue}
            subIssues={subIssues}
            onCreateSubIssue={onCreateSubIssue}
            onOpenTask={onOpenTask}
          />

          {(detailDataLoading || detailDataError) && (
            <div className={detailDataError ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" : "rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600"}>
              {detailDataError || "Kommentare, Blocker und Verlauf werden geladen..."}
            </div>
          )}

          <TaskDetailPanelBlockerSection
            canReport={controller.permissions.canReportBlocker}
            blockers={blockers}
            blockerDraft={controller.blockerDraft}
            pending={pending}
            profileName={profileName}
            onBlockerDraftChange={(patch) => controller.setBlockerDraft((current) => ({ ...current, ...patch }))}
            onReportBlocker={(draft) => {
              onReportBlocker(draft);
              controller.setBlockerDraft({ reason: "", impact: "", needsHelpFrom: "" });
            }}
          />

          <TaskDetailPanelNotesSection
            canEdit={controller.permissions.canEditNotes}
            note={controller.noteDraft}
            pending={pending}
            onChange={controller.setNoteDraft}
            onSave={controller.saveNote}
          />
        </main>

        <TaskDetailPanelSidebar
          task={task}
          pack={pack}
          teamProfiles={teamProfiles}
          packages={packages}
          parentDeliverables={allTasks.filter((item) => item.taskType === "deliverable")}
          sprints={sprints}
          milestones={milestones}
          canCompleteSubIssue={controller.permissions.canCompleteSubIssue}
          canManageFinalTaskStatus={controller.permissions.canManageFinalStatus}
          canManageTaskMeta={controller.permissions.canManageTaskMeta}
          canReparentSubIssue={controller.permissions.canReparentSubIssue}
          canManageReviewOwner={controller.permissions.canManageReviewOwner}
          canOpenReview={controller.permissions.canOpenReview}
          canReopenSubIssue={controller.permissions.canReopenSubIssue}
          canWithdrawTask={canWithdrawTask}
          canChangeTaskStatus={controller.permissions.canUpdateStatus}
          canUpdateWorkingTaskStatus={controller.permissions.canUpdateWorkingStatus}
          canApprove={canApprove}
          canReject={canReject}
          canReturnToDraft={canReturnToDraft}
          pending={pending}
          githubInstallationAvailable={githubInstallationAvailable}
          onUpdate={onUpdate}
          onSyncGitHub={onSyncGitHub}
          onOpenReview={onOpenReview}
          onWithdraw={onWithdraw}
          onDecideApproval={onDecideApproval}
        />
      </div>

      <div className="mt-5 min-w-0">
        <TaskCommentThread
          comments={comments}
          externalComments={externalComments}
          activities={activities}
          notice={commentImportNotice}
          profiles={teamProfiles}
          currentProfileId={currentProfile?.id || ""}
          pending={pending}
          importPending={commentImportPending}
          readOnly={!controller.permissions.canComment}
          onImportGitHubComments={onImportGitHubComments}
          onUploadAttachment={onUploadAttachment}
          onAddComment={onAddComment}
          title="Kommentare"
          description="Laufende Abstimmungen, Nachfragen und Updates zur Aufgabe."
        />
      </div>
      {error && <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
    </>
  );
}
