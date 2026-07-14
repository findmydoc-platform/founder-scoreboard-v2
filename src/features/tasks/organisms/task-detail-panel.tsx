"use client";

import { useEffect, useState } from "react";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";
import { TaskDetailPanelHeader } from "@/features/tasks/molecules/task-detail-panel-header";
import { TaskDetailSurface } from "@/features/tasks/organisms/task-detail-surface";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";
import type { ApprovalDecisionAction, AuthenticatedProfile, Milestone, Package, Profile, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskRelation, TaskRelationType } from "@/lib/types";

type Props = {
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
  onReportBlocker: (payload: { reason: string; impact: string; needsHelpFrom: string }) => void;
  onCreateSubIssue: () => void;
  onSyncGitHub: (options?: { createIfMissing?: boolean }) => void;
  onOpenReview: () => void;
  onWithdraw: (reason: string) => void;
  onAddRelation: (payload: { relationType: TaskRelationType; relatedTaskId: string; note: string }) => void;
  onRemoveRelation: (relation: TaskRelation) => void;
  onDecideApproval: (action: ApprovalDecisionAction, note?: string) => void;
};

export function TaskDetailPanel({ onClose, ...surfaceProps }: Props) {
  const [overviewDirty, setOverviewDirty] = useState(false);
  const { previousTask, onBack, ...taskSurfaceProps } = surfaceProps;
  const confirmDiscard = () => !overviewDirty || window.confirm("Ungespeicherte Änderungen verwerfen?");
  const requestClose = () => {
    if (confirmDiscard()) onClose();
  };
  const requestBack = () => {
    if (confirmDiscard()) onBack?.();
  };
  const dialogRef = useModalDialog({ open: true, onClose: requestClose });

  useEffect(() => {
    if (!overviewDirty) return;
    const handleBackspace = (event: KeyboardEvent) => {
      if (event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!overviewDirty || window.confirm("Ungespeicherte Änderungen verwerfen?")) (onBack || onClose)();
    };
    window.addEventListener("keydown", handleBackspace, true);
    return () => window.removeEventListener("keydown", handleBackspace, true);
  }, [onBack, onClose, overviewDirty]);

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-30 cursor-default bg-slate-950/20 backdrop-blur-[1px]"
        aria-label="Detailpanel schließen"
        onClick={requestClose}
      />
      <aside ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="task-detail-panel-title" className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[920px] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl">
        <TaskDetailPanelHeader task={taskSurfaceProps.task} previousTask={previousTask} onBack={onBack ? requestBack : undefined} onClose={requestClose} onRequestFullPage={confirmDiscard} />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
          <TaskDetailSurface key={taskSurfaceProps.task.id} {...taskSurfaceProps} surface="modal" onOverviewDirtyChange={setOverviewDirty} />
        </div>
      </aside>
    </>
  );
}
