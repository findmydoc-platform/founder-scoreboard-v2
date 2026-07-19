"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { TaskActionResult, TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";
import { useTaskDiscardGuard } from "@/features/tasks/hooks/use-task-discard-guard";
import { TaskDiscardChangesDialog } from "@/features/tasks/molecules/task-discard-changes-dialog";
import { TaskDetailPanelHeader } from "@/features/tasks/molecules/task-detail-panel-header";
import { TaskDetailSurface } from "@/features/tasks/organisms/task-detail-surface";
import { clearTaskReviewDraft } from "@/features/reviews/hooks/use-task-review-draft";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";
import type { ApprovalDecisionAction, AuthenticatedProfile, Milestone, Package, Profile, ReviewDecision, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskRelation, TaskRelationType, TaskReview, TaskReviewChecklist } from "@/lib/types";

type Props = {
  task: Task;
  pack?: Package;
  comments: TaskComment[];
  externalComments: TaskExternalComment[];
  activities: TaskActivity[];
  reviews: TaskReview[];
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
  allTasks: Task[];
  relations: TaskRelation[];
  currentProfile?: Pick<AuthenticatedProfile, "id" | "name" | "platformRole"> | null;
  source: "seed" | "supabase";
  pending: boolean;
  error?: string;
  githubInstallationAvailable: boolean;
  previousTask?: Task | null;
  onBack?: () => void;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onUpdate: (patch: Partial<Task>) => Promise<TaskUpdateResult> | void;
  onAddComment: (comment: string) => Promise<void> | void;
  onUploadAttachment: (file: File) => Promise<string>;
  onImportGitHubComments: () => void;
  onReportBlocker: (payload: { reason: string; impact: string; needsHelpFrom: string }) => Promise<TaskActionResult>;
  onCreateSubIssue: () => void;
  onSyncGitHub: (options?: { createIfMissing?: boolean }) => void;
  onReview: (task: Task, decision: ReviewDecision, score: number, checklist: TaskReviewChecklist, comment: string) => Promise<boolean> | boolean | void;
  onReopenReview: (task: Task) => void;
  onWithdrawReview: (task: Task, reason: string) => Promise<boolean> | boolean | void;
  onWithdraw: (reason: string) => void;
  onAddRelation: (payload: { relationType: TaskRelationType; relatedTaskId: string; note: string }) => Promise<TaskActionResult>;
  onRemoveRelation: (relation: TaskRelation) => void;
  onDecideApproval: (action: ApprovalDecisionAction, note?: string) => void;
};

export function TaskDetailPanel({ onClose, ...surfaceProps }: Props) {
  const router = useRouter();
  const [overviewDirty, setOverviewDirty] = useState(false);
  const { previousTask, onBack, ...taskSurfaceProps } = surfaceProps;
  const discardGuard = useTaskDiscardGuard(overviewDirty);
  const { discard, keepEditing, open: discardDialogOpen, request: requestDiscard } = discardGuard;
  const requestClose = () => requestDiscard(onClose);
  const requestBack = () => requestDiscard(() => onBack?.());
  const discardChanges = () => {
    if (taskSurfaceProps.task.reviewStatus === "requested") {
      clearTaskReviewDraft(taskSurfaceProps.task.id, taskSurfaceProps.task.reviewRequestedAt || "", taskSurfaceProps.currentProfile?.id || "");
    }
    discard();
  };
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose: requestClose, closeDisabled: discardDialogOpen });

  useEffect(() => {
    if (!overviewDirty) return;
    const handleBackspace = (event: KeyboardEvent) => {
      if (event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      requestDiscard(onBack || onClose);
    };
    window.addEventListener("keydown", handleBackspace, true);
    return () => window.removeEventListener("keydown", handleBackspace, true);
  }, [onBack, onClose, overviewDirty, requestDiscard]);

  return (
    <>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="task-detail-panel-title" className="fixed inset-0 z-30">
        <button
          type="button"
          tabIndex={-1}
          className="absolute inset-0 cursor-default bg-slate-950/25 backdrop-blur-[1px]"
          aria-label="Detailpanel schließen"
          onClick={requestClose}
        />
        <aside className={`${taskSurfaceProps.task.reviewStatus === "requested" ? "max-w-[1060px]" : "max-w-[920px]"} absolute inset-y-0 right-0 z-10 flex w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-xl transition-[max-width] duration-200`}>
          <TaskDetailPanelHeader
            task={taskSurfaceProps.task}
            previousTask={previousTask}
            onBack={onBack ? requestBack : undefined}
            onClose={requestClose}
            onRequestFullPage={(href) => {
              if (taskSurfaceProps.task.reviewStatus === "requested") return true;
              if (!overviewDirty) return true;
              requestDiscard(() => router.push(href));
              return false;
            }}
          />
          <div className="min-h-0 flex-1">
            <TaskDetailSurface
              key={taskSurfaceProps.task.id}
              {...taskSurfaceProps}
              surface="modal"
              onOverviewDirtyChange={setOverviewDirty}
              onRequestDiscardAction={requestDiscard}
            />
          </div>
        </aside>
      </div>
      <TaskDiscardChangesDialog
        open={discardDialogOpen}
        onDiscard={discardChanges}
        onKeepEditing={keepEditing}
      />
    </>
  );
}
