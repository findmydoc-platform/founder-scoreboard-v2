"use client";

import { BadgeCheck, ChevronRight, ClipboardCheck, UserCheck } from "lucide-react";
import { useState } from "react";
import { ApprovalDecisionDialog } from "@/features/planning/molecules/approval-decision-dialog";
import { currentApprovalDecisionReason, isTaskPlanningActive } from "@/features/planning/model/approval-domain";
import { reviewLabel } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { ApprovalReasonAction } from "@/lib/approval-decision-policy";
import type { ApprovalDecisionAction, Profile, Task } from "@/lib/types";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiButton } from "@/shared/atoms/ui-primitives";

type Props = {
  task: Task;
  teamProfiles: Profile[];
  canApprove: boolean;
  canReject: boolean;
  canReturnToDraft: boolean;
  canManageReviewOwner: boolean;
  canOpenReview: boolean;
  forceReviewSetup?: boolean;
  pending: boolean;
  onUpdate: (patch: Partial<Task>) => void;
  onOpenReview: () => void;
  onDecideApproval: (action: ApprovalDecisionAction, note?: string) => void;
};

function approvalTitle(task: Task) {
  if (task.taskType === "sub_issue") return "Parent wartet auf Freigabe";
  if (task.approvalStatus === "rejected") return "Freigabe abgelehnt";
  if (task.approvalStatus === "draft") return "Noch nicht zur Freigabe";
  return "Wartet auf Freigabe";
}

export function TaskDetailWorkflowStrips({
  task,
  teamProfiles,
  canApprove,
  canReject,
  canReturnToDraft,
  canManageReviewOwner,
  canOpenReview,
  forceReviewSetup = false,
  pending,
  onUpdate,
  onOpenReview,
  onDecideApproval,
}: Props) {
  const [decisionAction, setDecisionAction] = useState<ApprovalReasonAction | null>(null);
  const effectivelyApproved = isTaskPlanningActive(task);
  const showApproval = !effectivelyApproved;
  const decisionReason = currentApprovalDecisionReason(task);
  const reviewOpen = !task.scoreFinal && (normalizeStatus(task.status) === "Review" || task.reviewStatus === "requested");
  const showReview = forceReviewSetup
    || reviewOpen
    || task.reviewStatus !== "not_requested"
    || Boolean(task.reviewOwnerProfileId)
    || task.scoreFinal;
  const reviewOwnerProfile = teamProfiles.find((profile) => profile.id === task.reviewOwnerProfileId);
  const selfReview = Boolean(task.reviewOwnerProfileId && (task.assigneeId === task.reviewOwnerProfileId || task.assignee === task.reviewOwnerProfileId));

  if (!showApproval && !showReview) return null;

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-slate-200" aria-label="Workflow-Status">
      {showApproval ? (
        <section className="flex flex-wrap items-center justify-between gap-3 bg-blue-50/55 px-4 py-3" aria-label="Freigabe">
          <div className="flex min-w-0 items-center gap-3">
            <BadgeCheck size={18} className="shrink-0 text-blue-600" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-blue-950">{approvalTitle(task)}</div>
              <div className="mt-0.5 text-xs text-slate-600">
                {task.taskType === "deliverable" ? `Revision ${task.approvalRevision}` : "Das Sub-Issue wird mit dem Parent aktiv."}
                {decisionReason ? ` · ${decisionReason}` : ""}
              </div>
            </div>
          </div>
          {canApprove || canReject || canReturnToDraft ? (
            <div className="flex flex-wrap items-center gap-2">
              {canApprove ? <UiButton size="sm" variant="primary" disabled={pending} onClick={() => onDecideApproval("approve")}>Freigeben</UiButton> : null}
              {canReject ? <UiButton size="sm" disabled={pending} onClick={() => setDecisionAction("reject")}>Ablehnen</UiButton> : null}
              {canReturnToDraft ? <UiButton size="sm" disabled={pending} onClick={() => setDecisionAction("return_to_draft")}>Zur Überarbeitung</UiButton> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {showReview ? (
        <section className={`${showApproval ? "border-t " : ""}flex flex-wrap items-center justify-between gap-3 border-slate-200 bg-white px-4 py-3`} aria-label="Review">
          <div className="flex min-w-0 items-center gap-3">
            <ClipboardCheck size={18} className="shrink-0 text-slate-400" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">
                {reviewLabel(task.reviewStatus)}
                {task.scoreFinal ? ` · ${task.scorePoints} Punkte final` : ""}
              </div>
              {task.reviewRequestedAt ? (
                <div className="mt-0.5 text-xs text-slate-500">
                  Angefragt am {new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(task.reviewRequestedAt))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <UserCheck size={15} className="text-slate-400" aria-hidden="true" />
            {canManageReviewOwner ? (
              <CustomSelect
                value={task.reviewOwnerProfileId || ""}
                onChange={(reviewOwnerProfileId) => onUpdate({ reviewOwnerProfileId })}
                disabled={pending}
                className="h-9 w-48 text-sm"
                aria-label="Review-Verantwortung festlegen"
                options={[{ value: "", label: "Ohne Review-Verantwortung" }, ...teamProfiles.map((profile) => ({ value: profile.id, label: profile.name }))]}
              />
            ) : (
              <span className="text-sm font-medium text-slate-700">
                {reviewOwnerProfile?.name || task.reviewOwnerProfileId || "Ohne Review-Verantwortung"}
                {selfReview ? <span className="ml-2 text-xs font-semibold text-amber-700">Self-Review</span> : null}
              </span>
            )}
            {reviewOpen && canOpenReview && effectivelyApproved ? (
              <UiButton size="sm" variant="blue" disabled={pending} onClick={onOpenReview}>
                Review öffnen
                <ChevronRight size={15} aria-hidden="true" />
              </UiButton>
            ) : null}
          </div>
        </section>
      ) : null}

      {decisionAction ? (
        <ApprovalDecisionDialog
          action={decisionAction}
          entityLabel="Deliverable"
          pending={pending}
          onClose={() => setDecisionAction(null)}
          onConfirm={(note) => {
            const action = decisionAction;
            setDecisionAction(null);
            onDecideApproval(action, note);
          }}
        />
      ) : null}
    </div>
  );
}
