"use client";

import { CalendarDays, Link2, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApprovalDecisionDialog } from "@/features/planning/molecules/approval-decision-dialog";
import { PlanningTrashActionDialog } from "@/features/planning/molecules/planning-trash-action-dialog";
import { InitiativeRaciList } from "@/features/projects/molecules/initiative-raci-list";
import { currentApprovalDecisionReason, isApprovedDeliverable, isTaskPlanningActive } from "@/features/planning/model/approval-domain";
import { statusOptionsForRole } from "@/features/planning/model/planning-app-model";
import { TaskStatusControl } from "@/features/tasks/atoms/task-status-control";
import { isExpiredGitHubSyncPending } from "@/features/tasks/model/github-sync-queue";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { dateRange, formatDate, taskAssigneeLabel } from "@/lib/display";
import { hasGitHubIssue, reviewLabel } from "@/lib/platform";
import { UiDateField, UiSelectField } from "@/shared/atoms/form-controls";
import { UiButton } from "@/shared/atoms/ui-primitives";
import { normalizeStatus } from "@/lib/status";
import {
  assigneeOptions,
  initiativeOptions,
  milestoneOptions,
  parentDeliverableOptions,
  priorityOptions,
  sprintOptions,
} from "@/features/tasks/model/task-form-options";
import type { ApprovalDecisionAction, Milestone, Package, Profile, Sprint, Task } from "@/lib/types";
import type { ApprovalReasonAction } from "@/lib/approval-decision-policy";

type Props = {
  task: Task;
  pack?: Package;
  teamProfiles: Profile[];
  packages: Package[];
  parentDeliverables: Task[];
  sprints: Sprint[];
  milestones: Milestone[];
  canManageFinalTaskStatus: boolean;
  canManageTaskMeta: boolean;
  canReparentSubIssue: boolean;
  canManageReviewOwner: boolean;
  canOpenReview: boolean;
  canWithdrawTask: boolean;
  canChangeTaskStatus?: boolean;
  canApprove: boolean;
  canReject: boolean;
  canReturnToDraft: boolean;
  pending: boolean;
  githubInstallationAvailable: boolean;
  onUpdate: (patch: Partial<Task>) => void;
  onSyncGitHub: (options?: { createIfMissing?: boolean }) => void;
  onOpenReview: () => void;
  onWithdraw: (reason: string) => void;
  onDecideApproval: (action: ApprovalDecisionAction, note?: string) => void;
};

export function TaskDetailPanelSidebar({
  task,
  pack,
  teamProfiles,
  packages,
  parentDeliverables,
  sprints,
  milestones,
  canManageFinalTaskStatus,
  canManageTaskMeta,
  canReparentSubIssue,
  canManageReviewOwner,
  canOpenReview,
  canWithdrawTask,
  canChangeTaskStatus = canManageTaskMeta,
  canApprove,
  canReject,
  canReturnToDraft,
  pending,
  githubInstallationAvailable,
  onUpdate,
  onSyncGitHub,
  onOpenReview,
  onWithdraw,
  onDecideApproval,
}: Props) {
  const [decisionAction, setDecisionAction] = useState<ApprovalReasonAction | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const assigneeProfile = teamProfiles.find((profile) => profile.name === task.assignee || profile.id === task.assignee);
  const reviewOwnerProfile = teamProfiles.find((profile) => profile.id === task.reviewOwnerProfileId);
  const selfReview = Boolean(task.reviewOwnerProfileId && (task.assigneeId === task.reviewOwnerProfileId || task.assignee === task.reviewOwnerProfileId));
  const creatorProfile = teamProfiles.find((profile) => profile.name === task.createdBy || profile.id === task.createdBy)
    || teamProfiles.find((profile) => profile.platformRole === "ceo")
    || assigneeProfile;
  const currentPackage = packages.find((item) => item.id === task.packageId) || pack;
  const currentParent = parentDeliverables.find((item) => item.id === task.parentTaskId);
  const currentSprint = sprints.find((item) => item.id === task.sprintId);
  const currentMilestone = milestones.find((item) => item.id === task.milestoneId);
  const canSyncExistingGitHubIssue = hasGitHubIssue(task);
  const externalSyncPending = task.githubIssueSyncStatus === "pending" && !isExpiredGitHubSyncPending(task);
  const externalSyncProblem = task.githubIssueSyncStatus === "failed" || Boolean(task.githubIssueSyncError);
  const reviewOpen = !task.scoreFinal && (normalizeStatus(task.status) === "Review" || task.reviewStatus === "requested");
  const statusOptions = statusOptionsForRole(task.status, canManageTaskMeta, canManageFinalTaskStatus);
  const effectivelyApproved = isTaskPlanningActive(task);
  const decisionReason = currentApprovalDecisionReason(task);

  const updatePackage = (packageId: string) => {
    const nextPackage = packages.find((item) => item.id === packageId);
    onUpdate({ packageId, milestoneId: nextPackage?.milestoneId || task.milestoneId });
  };

  const updateMilestone = (milestoneId: string) => {
    const nextPackage = packages.find((item) => !milestoneId || !item.milestoneId || item.milestoneId === milestoneId);
    onUpdate({ milestoneId, packageId: nextPackage?.id || task.packageId });
  };

  const updateParentDeliverable = (parentTaskId: string) => {
    const parent = parentDeliverables.find((item) => item.id === parentTaskId);
    onUpdate({
      parentTaskId,
      packageId: parent?.packageId || "",
      milestoneId: parent?.milestoneId || "",
      parentApprovalStatus: parent?.approvalStatus || null,
    });
  };

  return (
    <div className="grid h-fit min-w-0 gap-4 lg:sticky lg:top-24">
      <section className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
        <h3 className="text-sm font-semibold text-slate-950">Freigabe</h3>
        {task.taskType === "sub_issue" ? (
          <p className="mt-2 text-sm text-slate-700">{task.parentApprovalStatus === "approved" ? "Durch Parent-Deliverable aktiv" : "Parent wartet auf Freigabe"}</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-blue-200 bg-white px-2 py-1 text-xs font-semibold text-blue-800">{task.approvalStatus || "ohne Status"}</span>
              <span className="text-xs text-slate-500">Revision {task.approvalRevision}</span>
            </div>
            {decisionReason && (
              <p className="mt-2 text-xs leading-5 text-slate-600">
                <span className="font-semibold text-slate-700">Begründung:</span> {decisionReason}
              </p>
            )}
            {(canApprove || canReject) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {canApprove && <UiButton size="xs" variant="primary" disabled={pending} onClick={() => onDecideApproval("approve")}>Freigeben</UiButton>}
                {canReject && <UiButton size="xs" disabled={pending} onClick={() => setDecisionAction("reject")}>Ablehnen</UiButton>}
              </div>
            )}
            {canReturnToDraft && <UiButton size="xs" className="mt-2" disabled={pending} onClick={() => setDecisionAction("return_to_draft")}>Zur Überarbeitung</UiButton>}
          </>
        )}
      </section>
      <section className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">Steuerung</h3>
        <div className="mt-3 grid gap-3">
          <div>
            <div className="text-xs font-semibold text-slate-500">Status</div>
            <TaskStatusControl
              status={task.status}
              canChange={canChangeTaskStatus && effectivelyApproved}
              onChange={(status) => onUpdate({ status })}
              options={statusOptions}
              className="mt-1"
            />
          </div>
          {canManageTaskMeta ? (
            <>
              <UiSelectField
                label="Zuständig"
                value={task.assigneeId || task.assignee}
                onChange={(value) => onUpdate({ assignee: value, assigneeId: value })}
                options={assigneeOptions(task.taskType, teamProfiles)}
              />
              <UiSelectField label="Priorität" value={task.priority} onChange={(value) => onUpdate({ priority: value })} options={priorityOptions} />
            </>
          ) : (
            <>
              <div>
                <div className="text-xs font-semibold text-slate-500">Zuständig</div>
                <div className="mt-1 flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-800">{taskAssigneeLabel(task)}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Priorität</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{task.priority}</div>
              </div>
            </>
          )}
        </div>
        {currentPackage && (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
            <div className="mb-1 font-semibold text-slate-700">Initiative-RACI</div>
            <InitiativeRaciList initiative={currentPackage} profiles={teamProfiles} className="grid gap-1" />
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">Planung</h3>
        <div className="mt-3 grid gap-3">
          {task.taskType === "sub_issue" ? (
            <>
              {canReparentSubIssue ? (
                <UiSelectField
                  label="Parent-Deliverable"
                  value={task.parentTaskId}
                  disabled={pending}
                  onChange={updateParentDeliverable}
                  options={parentDeliverableOptions(parentDeliverables, packages)}
                />
              ) : (
                <div>
                  <div className="text-xs font-semibold text-slate-500">Parent-Deliverable</div>
                  <div className="mt-1 break-words text-sm text-slate-800">{currentParent?.title || task.parentTaskId || "Nicht gesetzt"}</div>
                </div>
              )}
              <div>
                <div className="text-xs font-semibold text-slate-500">Geerbte Initiative</div>
                <div className="mt-1 break-words text-sm text-slate-800">{currentPackage?.title || "Ohne Initiative"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Geerbtes Epic / Meilenstein</div>
                <div className="mt-1 break-words text-sm text-slate-800">{currentMilestone?.title || "Kein Epic"}</div>
              </div>
              {task.parentApprovalStatus !== "approved" && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  Unter einem nicht freigegebenen Deliverable bleibt dieses Sub-Issue inaktiv.
                </p>
              )}
              {canManageTaskMeta ? (
                <>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <CustomDatePicker value={task.startDate || ""} onChange={(value) => onUpdate({ startDate: value })} className="h-9 text-sm" />
                      <CustomDatePicker value={task.endDate || ""} onChange={(value) => onUpdate({ endDate: value })} className="h-9 text-sm" />
                    </div>
                  </div>
                  <UiDateField label="Zieltermin" value={task.deadline || ""} onChange={(value) => onUpdate({ deadline: value })} />
                </>
              ) : (
                <>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
                    <div className="mt-1 flex items-center gap-2 text-sm text-slate-800"><CalendarDays size={15} />{dateRange(task)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Zieltermin</div>
                    <div className="mt-1 text-sm text-slate-800">{task.deadline ? formatDate(task.deadline) : "Kein Zieltermin"}</div>
                  </div>
                </>
              )}
            </>
          ) : canManageTaskMeta ? (
            <>
              <UiSelectField label="Initiative" value={task.packageId} onChange={updatePackage} options={initiativeOptions(packages)} />
              <UiSelectField label="Sprint" value={task.sprintId} disabled={!isApprovedDeliverable(task)} onChange={(value) => onUpdate({ sprintId: value })} options={sprintOptions(sprints)} />
              <UiSelectField
                label="Epic / Meilenstein"
                value={task.milestoneId || ""}
                onChange={updateMilestone}
                options={milestoneOptions(milestones, "Kein Epic")}
              />
              <div>
                <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <CustomDatePicker value={task.startDate || ""} onChange={(value) => onUpdate({ startDate: value })} className="h-9 text-sm" />
                  <CustomDatePicker value={task.endDate || ""} onChange={(value) => onUpdate({ endDate: value })} className="h-9 text-sm" />
                </div>
              </div>
              <UiDateField label="Zieltermin" value={task.deadline || ""} onChange={(value) => onUpdate({ deadline: value })} />
            </>
          ) : (
            <>
              <div>
                <div className="text-xs font-semibold text-slate-500">Initiative</div>
                <div className="mt-1 break-words text-sm text-slate-800">{currentPackage ? currentPackage.title : "ohne Initiative"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Sprint</div>
                <div className="mt-1 text-sm text-slate-800">{currentSprint?.name || "Kein Sprint"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Epic / Meilenstein</div>
                <div className="mt-1 break-words text-sm text-slate-800">{currentMilestone?.title || "Kein Epic"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
                <div className="mt-1 flex items-center gap-2 text-sm text-slate-800"><CalendarDays size={15} />{dateRange(task)}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Zieltermin</div>
                <div className="mt-1 text-sm text-slate-800">{task.deadline ? formatDate(task.deadline) : "Kein Zieltermin"}</div>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">Review & Historie</h3>
        <div className="mt-3 grid gap-3 text-sm text-slate-800">
          <div>
            <div className="text-xs font-semibold text-slate-500">Review</div>
            <div className="mt-1">{reviewLabel(task.reviewStatus)} · {task.scoreFinal ? `${task.scorePoints} Punkte final` : "noch nicht final bewertet"}</div>
            {reviewOpen && canOpenReview && effectivelyApproved ? (
              <button
                type="button"
                disabled={pending}
                onClick={onOpenReview}
                className="mt-2 h-8 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Zum Review-Blatt
              </button>
            ) : null}
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500">Review Owner</div>
            {canManageReviewOwner ? (
              <CustomSelect
                value={task.reviewOwnerProfileId || ""}
                onChange={(value) => onUpdate({ reviewOwnerProfileId: value })}
                className="mt-1 h-9 text-sm"
                options={[{ value: "", label: "Ohne Review Owner" }, ...teamProfiles.map((profile) => ({ value: profile.id, label: profile.name }))]}
              />
            ) : (
              <div className="mt-1">
                {reviewOwnerProfile?.name || task.reviewOwnerProfileId || "Ohne Review Owner"}
                {selfReview ? <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Self-Review</span> : null}
              </div>
            )}
            {!canManageReviewOwner ? <div className="mt-1 text-[11px] text-slate-400">Nur CEO kann den Review Owner ändern.</div> : null}
            {task.reviewRequestedAt ? (
              <div className="mt-1 text-xs text-slate-500">Angefragt am {new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(task.reviewRequestedAt))}</div>
            ) : null}
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500">Erstellt von</div>
            <div className="mt-1">{creatorProfile?.name || task.createdBy || "Unbekannt"}</div>
          </div>
          {(task.carriedFromSprintId || task.carryoverReason || task.sprintOutcome) && (
            <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-900">
              <div className="font-semibold">Sprint-Verlauf</div>
              {task.carriedFromSprintId && <div>Aus Sprint {task.carriedFromSprintId} übertragen.</div>}
              {task.sprintOutcome && <div>Outcome im ursprünglichen Sprint: {task.sprintOutcome}</div>}
              {task.carryoverReason && <div>{task.carryoverReason}</div>}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">GitHub Issue</h3>
            <p className="mt-1 text-xs text-slate-500">Mit der GitHub-Arbeitsfläche abgleichen.</p>
          </div>
          {canSyncExistingGitHubIssue ? (
            <button
              type="button"
              disabled={pending || !effectivelyApproved || externalSyncPending || !githubInstallationAvailable}
              onClick={() => onSyncGitHub()}
              className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {externalSyncPending ? "Sync..." : "Sync"}
            </button>
          ) : task.taskType === "deliverable" || task.taskType === "sub_issue" ? (
            <button
              type="button"
              disabled={pending || !effectivelyApproved || externalSyncPending || !githubInstallationAvailable}
              onClick={() => onSyncGitHub({ createIfMissing: true })}
              className="h-8 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {externalSyncPending ? "Anlegen..." : "GitHub Issue anlegen"}
            </button>
          ) : (
            <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500">Nicht score-relevant</span>
          )}
        </div>
        <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
          <p className="break-words font-medium text-slate-800">
            {externalSyncPending
              ? "GitHub-Sync läuft."
              : externalSyncProblem
                ? "GitHub-Sync braucht Aufmerksamkeit."
                : hasGitHubIssue(task)
                  ? "Diese Aufgabe ist mit GitHub verknüpft."
                  : "Diese Aufgabe hat noch kein GitHub Issue."}
          </p>
          {task.githubIssueUrl ? (
            <a href={task.githubIssueUrl} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-blue-700 hover:underline">
              <Link2 size={15} className="shrink-0" />
              <span className="truncate">GitHub Issue öffnen</span>
            </a>
          ) : (
            <p className="text-slate-500">Noch kein GitHub Issue.</p>
          )}
          {!hasGitHubIssue(task) && (
            <p className="text-xs text-slate-500">
              GitHub Issue nur bewusst anlegen.
            </p>
          )}
          {externalSyncProblem && <p className="text-xs font-semibold text-amber-700">Verbindung prüfen und erneut versuchen.</p>}
        </div>
      </section>

      {canWithdrawTask && (
        <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
          <h3 className="text-sm font-semibold text-amber-950">Papierkorb</h3>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            Entfernt das Deliverable und seine Sub-Issues aus der aktiven Planung. Die Inhalte bleiben bis zur späteren Bereinigung erhalten.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => setWithdrawOpen(true)}
            className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={14} />
            Deliverable zurückziehen
          </button>
        </section>
      )}
      {withdrawOpen && (
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
      )}
      {decisionAction && (
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
      )}
    </div>
  );
}
