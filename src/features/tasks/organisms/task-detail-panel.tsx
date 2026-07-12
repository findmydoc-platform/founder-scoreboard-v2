"use client";

import { TaskDetailPanelHeader } from "@/features/tasks/molecules/task-detail-panel-header";
import { TaskDetailSurface } from "@/features/tasks/organisms/task-detail-surface";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";
import type { AuthenticatedProfile, Milestone, Package, Profile, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskRelation, TaskRelationType } from "@/lib/types";

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
  onClose: () => void;
  onUpdate: (patch: Partial<Task>) => void;
  onAddComment: (comment: string) => Promise<void> | void;
  onUploadAttachment: (file: File) => Promise<string>;
  onImportGitHubComments: () => void;
  onReportBlocker: (payload: { reason: string; impact: string; needsHelpFrom: string }) => void;
  onCreateSubIssue: () => void;
  onSyncGitHub: (options?: { createIfMissing?: boolean }) => void;
  onOpenReview: () => void;
  onDelete: () => void;
  onAddRelation: (payload: { relationType: TaskRelationType; relatedTaskId: string; note: string }) => void;
  onRemoveRelation: (relation: TaskRelation) => void;
};

export function TaskDetailPanel({ onClose, ...surfaceProps }: Props) {
  const dialogRef = useModalDialog({ open: true, onClose });

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-30 cursor-default bg-slate-950/20 backdrop-blur-[1px]"
        aria-label="Detailpanel schließen"
        onClick={onClose}
      />
      <aside ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Aufgabendetails: ${surfaceProps.task.title}`} className="fixed inset-y-0 right-0 z-40 w-full max-w-[920px] overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
        <TaskDetailPanelHeader task={surfaceProps.task} onClose={onClose} />
        <div className="p-5">
          <TaskDetailSurface {...surfaceProps} />
        </div>
      </aside>
    </>
  );
}
