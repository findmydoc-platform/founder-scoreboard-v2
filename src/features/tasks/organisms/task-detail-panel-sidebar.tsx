"use client";

import { BadgeCheck, CalendarDays, ExternalLink, GitBranch, History, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ApprovalDecisionDialog } from "@/features/planning/molecules/approval-decision-dialog";
import { PlanningTrashActionDialog } from "@/features/planning/molecules/planning-trash-action-dialog";
import { currentApprovalDecisionReason, isApprovedDeliverable, isTaskPlanningActive } from "@/features/planning/model/approval-domain";
import { InitiativeRaciList } from "@/features/projects/molecules/initiative-raci-list";
import { isExpiredGitHubSyncPending } from "@/features/tasks/model/github-sync-queue";
import {
  initiativeOptions,
  milestoneOptions,
  parentDeliverableOptions,
  sprintOptions,
} from "@/features/tasks/model/task-form-options";
import { dateRange, formatDate } from "@/lib/display";
import { hasGitHubIssue, reviewLabel } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { ApprovalReasonAction } from "@/lib/approval-decision-policy";
import type { ApprovalDecisionAction, Milestone, Package, Profile, Sprint, Task } from "@/lib/types";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiSelectField } from "@/shared/atoms/form-controls";
import { UiButton } from "@/shared/atoms/ui-primitives";

type Props = {
  task: Task;
  pack?: Package;
  teamProfiles: Profile[];
  packages: Package[];
  parentDeliverables: Task[];
  sprints: Sprint[];
  milestones: Milestone[];
  canCompleteSubIssue: boolean;
  canManageFinalTaskStatus: boolean;
  canManageTaskMeta: boolean;
  canReparentSubIssue: boolean;
  canManageReviewOwner: boolean;
  canOpenReview: boolean;
  canReopenSubIssue: boolean;
  canWithdrawTask: boolean;
  canChangeTaskStatus?: boolean;
  canUpdateWorkingTaskStatus: boolean;
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

function DetailCard({ title, icon, tone = "default", children }: { title: string; icon?: ReactNode; tone?: "default" | "blue" | "amber"; children: ReactNode }) {
  const className = tone === "blue"
    ? "border-blue-200 bg-blue-50/40"
    : tone === "amber"
      ? "border-amber-200 bg-amber-50/50"
      : "border-slate-200 bg-white";
  return (
    <section className={`rounded-xl border p-4 ${className}`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950">{icon}{title}</h3>
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}

function ReadFact({ label, children }: { label: string; children: ReactNode }) {
  return <div><div className="text-xs font-semibold text-slate-500">{label}</div><div className="mt-1 break-words text-sm leading-6 text-slate-800">{children}</div></div>;
}

export function TaskDetailPanelSidebar({
  task,
  pack,
  teamProfiles,
  packages,
  parentDeliverables,
  sprints,
  milestones,
  canManageTaskMeta,
  canReparentSubIssue,
  canManageReviewOwner,
  canOpenReview,
  canWithdrawTask,
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
  const effectivelyApproved = isTaskPlanningActive(task);
  const reviewOpen = !task.scoreFinal && (normalizeStatus(task.status) === "Review" || task.reviewStatus === "requested");
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
    <div className="grid h-fit min-w-0 gap-4">
      <DetailCard title="Planung" icon={<CalendarDays size={16} className="text-blue-600" aria-hidden="true" />}>
        {task.taskType === "sub_issue" ? (
          <>
            {canReparentSubIssue ? (
              <UiSelectField label="Parent-Deliverable" value={task.parentTaskId} disabled={pending} onChange={updateParentDeliverable} options={parentDeliverableOptions(parentDeliverables, packages)} selectClassName="h-11 text-sm" />
            ) : <ReadFact label="Parent-Deliverable">{currentParent?.title || task.parentTaskId || "Nicht gesetzt"}</ReadFact>}
            <ReadFact label="Geerbte Initiative">{currentPackage?.title || "Ohne Initiative"}</ReadFact>
            <ReadFact label="Geerbtes Epic / Meilenstein">{currentMilestone?.title || "Kein Epic"}</ReadFact>
            {task.parentApprovalStatus !== "approved" ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">Unter einem nicht freigegebenen Deliverable bleibt dieses Sub-Issue inaktiv.</p> : null}
          </>
        ) : canManageTaskMeta ? (
          <>
            <UiSelectField label="Initiative" value={task.packageId} onChange={updatePackage} options={initiativeOptions(packages)} selectClassName="h-11 text-sm" />
            <UiSelectField label="Sprint" value={task.sprintId} disabled={!isApprovedDeliverable(task) || pending} onChange={(value) => onUpdate({ sprintId: value })} options={sprintOptions(sprints)} selectClassName="h-11 text-sm" />
            <UiSelectField label="Epic / Meilenstein" value={task.milestoneId || ""} onChange={updateMilestone} options={milestoneOptions(milestones, "Kein Epic")} selectClassName="h-11 text-sm" />
          </>
        ) : (
          <>
            <ReadFact label="Initiative">{currentPackage?.title || "Ohne Initiative"}</ReadFact>
            <ReadFact label="Sprint">{currentSprint?.name || "Kein Sprint"}</ReadFact>
            <ReadFact label="Epic / Meilenstein">{currentMilestone?.title || "Kein Epic"}</ReadFact>
          </>
        )}
        {canManageTaskMeta ? (
          <div>
            <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <CustomDatePicker value={task.startDate || ""} onChange={(value) => onUpdate({ startDate: value })} className="h-11 text-sm" />
              <CustomDatePicker value={task.endDate || ""} onChange={(value) => onUpdate({ endDate: value })} className="h-11 text-sm" />
            </div>
          </div>
        ) : <ReadFact label="Zeitraum">{dateRange(task)}</ReadFact>}
        {currentPackage ? <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"><div className="mb-2 font-semibold text-slate-700">Initiative-RACI</div><InitiativeRaciList initiative={currentPackage} profiles={teamProfiles} className="grid gap-1" /></div> : null}
      </DetailCard>

      <DetailCard title="Freigabe" icon={<BadgeCheck size={16} className="text-blue-600" aria-hidden="true" />} tone="blue">
        {task.taskType === "sub_issue" ? (
          <p className="text-sm text-slate-700">{task.parentApprovalStatus === "approved" ? "Durch Parent-Deliverable aktiv" : "Parent wartet auf Freigabe"}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-blue-200 bg-white px-2 py-1 text-xs font-semibold text-blue-800">{task.approvalStatus || "ohne Status"}</span><span className="text-xs text-slate-500">Revision {task.approvalRevision}</span></div>
            {decisionReason ? <p className="text-xs leading-5 text-slate-600"><span className="font-semibold text-slate-700">Begründung:</span> {decisionReason}</p> : null}
            {(canApprove || canReject || canReturnToDraft) ? (
              <div className="flex flex-wrap gap-2">
                {canApprove ? <UiButton size="lg" variant="primary" disabled={pending} onClick={() => onDecideApproval("approve")}>Freigeben</UiButton> : null}
                {canReject ? <UiButton size="lg" disabled={pending} onClick={() => setDecisionAction("reject")}>Ablehnen</UiButton> : null}
                {canReturnToDraft ? <UiButton size="lg" disabled={pending} onClick={() => setDecisionAction("return_to_draft")}>Zur Überarbeitung</UiButton> : null}
              </div>
            ) : null}
          </>
        )}
      </DetailCard>

      <DetailCard title="Review">
        <ReadFact label="Status">{reviewLabel(task.reviewStatus)} · {task.scoreFinal ? `${task.scorePoints} Punkte final` : "noch nicht final bewertet"}</ReadFact>
        {reviewOpen && canOpenReview && effectivelyApproved ? <UiButton size="lg" variant="blue" disabled={pending} onClick={onOpenReview}>Zum Review-Blatt</UiButton> : null}
        <div>
          <div className="text-xs font-semibold text-slate-500">Review Owner</div>
          {canManageReviewOwner ? (
            <CustomSelect value={task.reviewOwnerProfileId || ""} onChange={(value) => onUpdate({ reviewOwnerProfileId: value })} className="mt-1 h-11 text-sm" options={[{ value: "", label: "Ohne Review Owner" }, ...teamProfiles.map((profile) => ({ value: profile.id, label: profile.name }))]} />
          ) : <div className="mt-1 text-sm text-slate-800">{reviewOwnerProfile?.name || task.reviewOwnerProfileId || "Ohne Review Owner"}{selfReview ? <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Self-Review</span> : null}</div>}
        </div>
        {task.reviewRequestedAt ? <p className="text-xs text-slate-500">Angefragt am {new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(task.reviewRequestedAt))}</p> : null}
      </DetailCard>

      <DetailCard title="GitHub Issue" icon={<GitBranch size={16} aria-hidden="true" />}>
        <p className="text-sm leading-6 text-slate-700">{externalSyncPending ? "GitHub-Sync läuft." : externalSyncProblem ? "GitHub-Sync braucht Aufmerksamkeit." : canSyncExistingGitHubIssue ? "Dieses Item ist mit GitHub verknüpft." : "Noch kein GitHub Issue verknüpft."}</p>
        {task.githubIssueUrl ? <a href={task.githubIssueUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ExternalLink size={15} aria-hidden="true" />GitHub Issue öffnen</a> : null}
        <UiButton
          size="lg"
          disabled={pending || !effectivelyApproved || externalSyncPending || !githubInstallationAvailable}
          onClick={() => onSyncGitHub(canSyncExistingGitHubIssue ? undefined : { createIfMissing: true })}
        >
          {externalSyncPending ? "Synchronisiert …" : canSyncExistingGitHubIssue ? "Mit GitHub synchronisieren" : "GitHub Issue anlegen"}
        </UiButton>
        {!canSyncExistingGitHubIssue ? <p className="text-xs text-slate-500">GitHub Issue nur bewusst anlegen.</p> : null}
        {externalSyncProblem ? <p className="text-xs font-semibold text-amber-700">Verbindung prüfen und erneut versuchen.</p> : null}
      </DetailCard>

      <DetailCard title="Historie" icon={<History size={16} className="text-slate-500" aria-hidden="true" />}>
        <ReadFact label="Erstellt von">{creatorProfile?.name || task.createdBy || "Unbekannt"}</ReadFact>
        {task.updatedAt ? <ReadFact label="Zuletzt aktualisiert">{formatDate(task.updatedAt)}</ReadFact> : null}
        {(task.carriedFromSprintId || task.carryoverReason || task.sprintOutcome) ? (
          <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-900">
            <div className="font-semibold">Sprint-Verlauf</div>
            {task.carriedFromSprintId ? <div>Aus Sprint {task.carriedFromSprintId} übertragen.</div> : null}
            {task.sprintOutcome ? <div>Outcome im ursprünglichen Sprint: {task.sprintOutcome}</div> : null}
            {task.carryoverReason ? <div>{task.carryoverReason}</div> : null}
          </div>
        ) : <p className="text-sm text-slate-500">Keine Sprint-Übertragung dokumentiert.</p>}
      </DetailCard>

      {canWithdrawTask ? (
        <DetailCard title="Papierkorb" icon={<Trash2 size={16} className="text-amber-700" aria-hidden="true" />} tone="amber">
          <p className="text-xs leading-5 text-amber-900">Entfernt das Deliverable und seine Sub-Issues aus der aktiven Planung. Die Inhalte bleiben im bestehenden Papierkorb-Workflow erhalten.</p>
          <UiButton size="lg" variant="amber" disabled={pending} onClick={() => setWithdrawOpen(true)}><Trash2 size={14} aria-hidden="true" />Deliverable zurückziehen</UiButton>
        </DetailCard>
      ) : null}

      {withdrawOpen ? <PlanningTrashActionDialog action="withdraw" entityLabel="Deliverable" itemTitle={task.title} pending={pending} onClose={() => setWithdrawOpen(false)} onConfirm={(reason) => { setWithdrawOpen(false); onWithdraw(reason); }} /> : null}
      {decisionAction ? <ApprovalDecisionDialog action={decisionAction} entityLabel="Deliverable" pending={pending} onClose={() => setDecisionAction(null)} onConfirm={(note) => { const action = decisionAction; setDecisionAction(null); onDecideApproval(action, note); }} /> : null}
    </div>
  );
}
