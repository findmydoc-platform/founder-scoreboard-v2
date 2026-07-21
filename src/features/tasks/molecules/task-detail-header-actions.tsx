"use client";

import { ExternalLink, GitBranch, Pencil, RefreshCw, Trash2, UserCheck } from "lucide-react";
import { useState } from "react";
import { PlanningTrashActionDialog } from "@/features/planning/molecules/planning-trash-action-dialog";
import { isTaskPlanningActive } from "@/features/planning/model/approval-domain";
import { isExpiredGitHubSyncPending } from "@/features/tasks/model/github-sync-queue";
import { TaskSharePopover } from "@/features/tasks/molecules/task-share-popover";
import { splitGitHubRepository } from "@/lib/github-repositories";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task } from "@/lib/types";
import { classNames, UiButton } from "@/shared/atoms/ui-primitives";
import { CustomActionMenu, type CustomActionMenuGroup } from "@/shared/molecules/custom-action-menu";

type Props = {
  task: Task;
  canEditOverview: boolean;
  canManageReviewOwner: boolean;
  canWithdrawTask: boolean;
  githubInstallationAvailable: boolean;
  pending: boolean;
  onEditOverview: () => void;
  onShowReviewSetup: () => void;
  onSyncGitHub: (options?: { createIfMissing?: boolean }) => void;
  onWithdraw: (reason: string) => void;
};

function githubIssueLabel(task: Task) {
  const direct = task.githubIssueNumber || task.issueNumber;
  if (direct) return `#${direct}`;
  const url = task.githubIssueUrl || task.issueUrl;
  const match = url.match(/\/issues\/(\d+)/);
  return match ? `#${match[1]}` : "GitHub";
}

export function TaskDetailHeaderActions({
  task,
  canEditOverview,
  canManageReviewOwner,
  canWithdrawTask,
  githubInstallationAvailable,
  pending,
  onEditOverview,
  onShowReviewSetup,
  onSyncGitHub,
  onWithdraw,
}: Props) {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const linkedIssue = hasGitHubIssue(task);
  const issueUrl = task.githubIssueUrl || task.issueUrl;
  const githubRepository = linkedIssue ? splitGitHubRepository(task.githubRepo) : null;
  const repositoryLabel = githubRepository?.repo || "";
  const issueLabel = githubIssueLabel(task);
  const issueReference = `${githubRepository?.repository || task.githubRepo} ${issueLabel}`;
  const externalSyncPending = task.githubIssueSyncStatus === "pending" && !isExpiredGitHubSyncPending(task);
  const externalSyncProblem = task.githubIssueSyncStatus === "failed" || Boolean(task.githubIssueSyncError);
  const effectivelyApproved = isTaskPlanningActive(task);
  const syncDisabledReason = pending
    ? "Änderung wird gespeichert."
    : !effectivelyApproved
      ? "GitHub ist erst nach der Freigabe verfügbar."
      : externalSyncPending
        ? "GitHub-Synchronisierung läuft bereits."
        : !githubInstallationAvailable
          ? "Keine GitHub-Installation verfügbar."
          : undefined;

  const groups: CustomActionMenuGroup[] = [
    {
      id: "workflow",
      label: "Workflow",
      items: [
        ...(canManageReviewOwner ? [{
          id: "review-owner",
          label: "Review-Verantwortung festlegen",
          icon: <UserCheck size={16} />,
          onSelect: onShowReviewSetup,
        }] : []),
        {
          id: "github-sync",
          label: externalSyncPending
            ? "Synchronisierung läuft …"
            : linkedIssue ? "Mit GitHub synchronisieren" : "GitHub Issue anlegen",
          icon: <RefreshCw size={16} />,
          disabled: Boolean(syncDisabledReason),
          disabledReason: syncDisabledReason,
          onSelect: () => onSyncGitHub(linkedIssue ? undefined : { createIfMissing: true }),
        },
      ],
    },
    ...(canWithdrawTask ? [{
      id: "planning",
      label: "Planung",
      items: [{
        id: "withdraw",
        label: "Deliverable zurückziehen",
        icon: <Trash2 size={16} />,
        tone: "danger" as const,
        disabled: pending,
        disabledReason: pending ? "Änderung wird gespeichert." : undefined,
        onSelect: () => setWithdrawOpen(true),
      }],
    }] : []),
  ];

  return (
    <>
      <div className="flex w-full shrink-0 flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
        {linkedIssue ? (
          issueUrl ? (
            <a
              href={issueUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`GitHub Issue ${issueReference} öffnen${externalSyncProblem ? ", Synchronisierung braucht Aufmerksamkeit" : ""}`}
              title={externalSyncProblem ? `${issueReference}: GitHub-Synchronisierung braucht Aufmerksamkeit` : `GitHub Issue ${issueReference} öffnen`}
              className={classNames(
                "relative inline-flex h-11 items-center gap-1.5 rounded-md border bg-white px-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-500",
                externalSyncProblem
                  ? "border-amber-300 text-slate-800 hover:bg-amber-50"
                  : "border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50",
              )}
            >
              <GitBranch size={16} aria-hidden="true" />
              <span className="max-w-36 truncate text-xs font-medium text-slate-600">{repositoryLabel}</span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span>{issueLabel}</span>
              <ExternalLink size={14} className="text-slate-400" aria-hidden="true" />
              {externalSyncProblem ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-500" aria-hidden="true" /> : null}
            </a>
          ) : (
            <span className="relative inline-flex h-11 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-semibold text-slate-700" title={`GitHub Issue ${issueReference} verknüpft`}>
              <GitBranch size={16} aria-hidden="true" />
              <span className="max-w-36 truncate text-xs font-medium text-slate-600">{repositoryLabel}</span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span>{issueLabel}</span>
              {externalSyncProblem ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-500" aria-hidden="true" /> : null}
            </span>
          )
        ) : null}

        <TaskSharePopover task={task} />

        {canEditOverview ? (
          <UiButton
            id="task-detail-edit"
            type="button"
            variant="blueOutline"
            size="iconLg"
            aria-label="Bearbeiten"
            title="Bearbeiten"
            onClick={onEditOverview}
            disabled={pending}
          >
            <Pencil size={16} aria-hidden="true" />
          </UiButton>
        ) : null}

        <CustomActionMenu
          label="Weitere Item-Aktionen"
          groups={groups}
          disabled={!groups.some((group) => group.items.length > 0)}
          triggerAriaLabel="Weitere Item-Aktionen"
          triggerClassName="h-11 w-11 min-h-11 min-w-11"
          menuClassName="rounded-lg"
        />
      </div>

      {withdrawOpen ? (
        <PlanningTrashActionDialog
          action="withdraw"
          entityLabel="Deliverable"
          itemTitle={task.title}
          pending={pending}
          onClose={() => setWithdrawOpen(false)}
          onConfirm={(reason) => {
            setWithdrawOpen(false);
            onWithdraw(reason);
          }}
        />
      ) : null}
    </>
  );
}
