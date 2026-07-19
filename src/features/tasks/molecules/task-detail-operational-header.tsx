"use client";

import { CalendarDays, Flag, Hourglass, ListChecks, UserRound } from "lucide-react";
import { useId, type ReactNode } from "react";
import { TaskStatusControl, TaskStatusBadge } from "@/features/tasks/atoms/task-status-control";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { assigneeOptions, priorityOptions } from "@/features/tasks/model/task-form-options";
import { formatDate, profileNameById, taskAssigneeLabel } from "@/lib/display";
import { normalizeStatus, priorityBadgeTone } from "@/lib/status";
import type { Milestone, Package, Profile, Task, TaskRelation, TaskStatus } from "@/lib/types";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { classNames, UiBadge } from "@/shared/atoms/ui-primitives";

export type TaskDetailRelationshipRow = {
  relation: TaskRelation;
  task?: Task;
};

export type TaskDetailOperationalHeaderProps = {
  task: Task;
  initiative?: Package;
  milestone?: Milestone;
  parentTask?: Task;
  profiles: Profile[];
  subIssues: Task[];
  subIssuesKnown?: boolean;
  statusOptions: TaskStatus[];
  canChangeStatus: boolean;
  statusLockedReason?: string;
  canManageTaskMeta: boolean;
  pending?: boolean;
  titleId?: string;
  className?: string;
  actions?: ReactNode;
  onUpdate: (patch: Partial<Task>) => void;
};

export type TaskDetailDependencyBandProps = {
  anchorId?: string;
  blocks: TaskDetailRelationshipRow[];
  className?: string;
  error?: string;
  loading?: boolean;
  onOpenTask: (taskId: string) => void;
  variant?: "band" | "review";
  waitsOn: TaskDetailRelationshipRow[];
};

function OperationalFact({
  children,
  emphasized = false,
  hideLabel = false,
  icon,
  label,
}: {
  children: ReactNode;
  emphasized?: boolean;
  hideLabel?: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <div className={classNames(
      "flex min-h-10 min-w-0 items-center gap-2 sm:border-l sm:border-slate-200 sm:pl-4 sm:first:border-l-0 sm:first:pl-0",
      emphasized && "text-blue-950",
    )}>
      <span className={classNames("shrink-0", emphasized ? "text-blue-600" : "text-slate-400")} aria-hidden="true">{icon}</span>
      <span className={hideLabel ? "sr-only" : "shrink-0 text-xs font-medium text-slate-500"}>{label}</span>
      <div className="min-w-0 text-sm font-semibold text-slate-900">{children}</div>
    </div>
  );
}

function SubIssueProgress({ completed, total }: { completed: number; total: number }) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <OperationalFact label="Sub-Issue-Fortschritt" hideLabel icon={<ListChecks size={16} />}>
      <div
        className="w-40"
        role="progressbar"
        aria-label={`${completed} von ${total} Sub-Issues erledigt`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
      >
        <div>{completed} von {total} erledigt</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
          <div className="h-full rounded-full bg-blue-600" style={{ width: `${percentage}%` }} />
        </div>
      </div>
    </OperationalFact>
  );
}

function DependencyLinkedTask({ onOpenTask, task }: { onOpenTask: (taskId: string) => void; task: Task }) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <TaskReferenceLink task={task} onOpenTask={onOpenTask} className="min-w-0 break-words font-semibold text-slate-900">
        {task.title}
      </TaskReferenceLink>
      <TaskStatusBadge status={task.status} size="xs" />
      <span className="text-xs font-medium text-slate-600">{taskAssigneeLabel(task)}</span>
    </div>
  );
}

function DependencyBandRow({
  icon,
  label,
  onOpenTask,
  rows,
  tone,
}: {
  icon: ReactNode;
  label: string;
  onOpenTask: (taskId: string) => void;
  rows: Array<TaskDetailRelationshipRow & { task: Task }>;
  tone: "primary" | "secondary";
}) {
  const first = rows[0];
  if (!first) return null;

  return (
    <div className={classNames(
      "grid min-w-0 gap-2 px-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center sm:gap-3",
      tone === "primary"
        ? "bg-amber-50 py-3 text-amber-950"
        : "border-t border-slate-200 bg-slate-50/70 py-2.5 text-slate-900",
    )}>
      <div className={classNames(
        "flex items-center gap-2 text-sm font-semibold",
        tone === "primary" ? "text-amber-900" : "text-slate-700",
      )}>
        {icon}
        <span>{label} {rows.length}</span>
      </div>
      <DependencyLinkedTask task={first.task} onOpenTask={onOpenTask} />
      {rows.length > 1 && (
        <span className={classNames(
          "shrink-0 rounded-full border px-2 py-1 text-xs font-semibold",
          tone === "primary"
            ? "border-amber-200 bg-white text-amber-800"
            : "border-slate-200 bg-white text-slate-600",
        )}>
          +{rows.length - 1} weitere
        </span>
      )}
    </div>
  );
}

function activeDependencyRows(rows: TaskDetailRelationshipRow[]): Array<TaskDetailRelationshipRow & { task: Task }> {
  return rows.filter((row): row is TaskDetailRelationshipRow & { task: Task } => (
    Boolean(row.task) && normalizeStatus(row.task?.status || "") !== "Erledigt"
  ));
}

function ReviewDependencyList({
  icon,
  label,
  onOpenTask,
  rows,
}: {
  icon: ReactNode;
  label: string;
  onOpenTask: (taskId: string) => void;
  rows: Array<TaskDetailRelationshipRow & { task: Task }>;
}) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        {icon}
        <span>{label}</span>
      </div>
      <ul className="mt-2 grid gap-2">
        {rows.map((row) => (
          <li key={row.relation.id} className="flex min-h-9 items-center rounded-md bg-slate-50 px-3 py-2">
            <DependencyLinkedTask task={row.task} onOpenTask={onOpenTask} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TaskDetailDependencyBand({
  anchorId,
  blocks,
  className,
  error = "",
  loading = false,
  onOpenTask,
  variant = "band",
  waitsOn,
}: TaskDetailDependencyBandProps) {
  const activeWaitsOn = activeDependencyRows(waitsOn);
  const activeBlocks = activeDependencyRows(blocks);

  if (variant === "review") {
    return (
      <section id={anchorId} tabIndex={-1} className={classNames("scroll-mt-6 border-b border-slate-100 py-5 outline-none", className)} aria-label="Abhängigkeiten">
        <h3 className="text-sm font-semibold text-slate-950">Abhängigkeiten</h3>
        {error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-red-700">Zusätzliche Item-Daten konnten nicht geladen werden. {error}</p>
        ) : loading ? (
          <div className="mt-2 h-12 animate-pulse rounded-md bg-slate-100" aria-label="Abhängigkeiten werden geladen" aria-busy="true" />
        ) : !activeWaitsOn.length && !activeBlocks.length ? (
          <p className="mt-2 text-[15px] leading-7 text-slate-500">Keine offene Abhängigkeit erfasst.</p>
        ) : (
          <div className="mt-3 grid gap-4">
            <ReviewDependencyList
              label="Wartet auf"
              rows={activeWaitsOn}
              icon={<Hourglass size={15} aria-hidden="true" />}
              onOpenTask={onOpenTask}
            />
            <ReviewDependencyList
              label="Andere warten hierauf"
              rows={activeBlocks}
              icon={<Flag size={15} aria-hidden="true" />}
              onOpenTask={onOpenTask}
            />
          </div>
        )}
      </section>
    );
  }

  if (error) {
    return (
      <section
        role="alert"
        aria-label="Item-Daten"
        className={classNames("mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700", className)}
      >
        Zusätzliche Item-Daten konnten nicht geladen werden. {error}
      </section>
    );
  }

  if (loading) {
    return (
      <section
        aria-label="Abhängigkeiten werden geladen"
        aria-busy="true"
        className={classNames("mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-3", className)}
      >
        <div className="h-12 animate-pulse rounded-md bg-slate-100" />
      </section>
    );
  }

  if (!activeWaitsOn.length && !activeBlocks.length) return null;

  return (
    <section className={classNames(
      "mt-4 overflow-hidden rounded-lg border",
      activeWaitsOn.length > 0 ? "border-amber-200" : "border-slate-200",
      className,
    )} aria-label="Abhängigkeiten">
      <DependencyBandRow
        label="Wartet auf"
        rows={activeWaitsOn}
        tone="primary"
        icon={<Hourglass size={17} aria-hidden="true" />}
        onOpenTask={onOpenTask}
      />
      <DependencyBandRow
        label="Andere warten hierauf"
        rows={activeBlocks}
        tone="secondary"
        icon={<Flag size={17} aria-hidden="true" />}
        onOpenTask={onOpenTask}
      />
    </section>
  );
}

export function TaskDetailOperationalHeader({
  task,
  initiative,
  milestone,
  parentTask,
  profiles,
  subIssues,
  subIssuesKnown = true,
  statusOptions,
  canChangeStatus,
  statusLockedReason,
  canManageTaskMeta,
  pending = false,
  titleId,
  className,
  actions,
  onUpdate,
}: TaskDetailOperationalHeaderProps) {
  const generatedTitleId = useId();
  const resolvedTitleId = titleId || generatedTitleId;
  const itemTypeLabel = task.taskType === "sub_issue" ? "Sub-Issue" : "Deliverable";
  const hierarchyLabel = task.taskType === "sub_issue"
    ? parentTask?.title
    : initiative?.title;
  const milestoneLabel = milestone?.title;
  const accountableLabel = initiative
    ? profileNameById(profiles, initiative.accountableProfileId || initiative.ownerId)
    : "";
  const directSubIssues = subIssues.filter((subIssue) => subIssue.parentTaskId === task.id);
  const completedSubIssues = directSubIssues.filter((subIssue) => normalizeStatus(subIssue.status) === "Erledigt").length;
  const showDeadline = canManageTaskMeta || Boolean(task.deadline);

  return (
    <header aria-labelledby={resolvedTitleId} className={classNames("bg-white", className)}>
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span>{itemTypeLabel}</span>
            {(milestoneLabel || hierarchyLabel) && (
              <>
                <span aria-hidden="true">·</span>
                <span className="normal-case tracking-normal text-slate-600">
                  {task.taskType === "sub_issue" ? `Parent: ${hierarchyLabel || "Nicht gesetzt"}` : milestoneLabel || hierarchyLabel}
                </span>
              </>
            )}
            {accountableLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="normal-case tracking-normal text-slate-600">
                  Accountable: {accountableLabel}
                </span>
              </>
            )}
          </div>
          <h1 id={resolvedTitleId} className="mt-2 max-w-5xl break-words text-2xl font-semibold leading-tight tracking-tight text-slate-950">
            {task.title}
          </h1>
        </div>
        {actions}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 border-y border-slate-200 py-3">
        <div className="flex min-h-10 min-w-0 items-center">
          <TaskStatusControl
            status={task.status}
            canChange={canChangeStatus && !pending}
            lockedReason={pending ? "Änderung wird gespeichert." : statusLockedReason}
            showLockedReason={false}
            options={statusOptions}
            selectClassName="h-10 w-36 text-sm"
            compact
            onChange={(status) => onUpdate({ status })}
          />
        </div>

        {canManageTaskMeta ? (
          <OperationalFact label="Zuständig" emphasized icon={<UserRound size={16} />}>
            <CustomSelect
              value={task.assigneeId || task.assignee}
              options={assigneeOptions(task.taskType, profiles)}
              disabled={pending}
              className="h-8 w-36 text-sm"
              aria-label="Zuständige Person ändern"
              onChange={(value) => onUpdate({ assignee: value, assigneeId: value })}
            />
          </OperationalFact>
        ) : (
          <OperationalFact label="Zuständig" emphasized icon={<UserRound size={16} />}>{taskAssigneeLabel(task)}</OperationalFact>
        )}

        {canManageTaskMeta ? (
          <OperationalFact label="Priorität" hideLabel icon={<Flag size={16} />}>
            <CustomSelect
              value={task.priority}
              options={priorityOptions}
              disabled={pending}
              className="h-8 w-20 text-sm"
              aria-label="Priorität ändern"
              onChange={(value) => onUpdate({ priority: value })}
            />
          </OperationalFact>
        ) : (
          <OperationalFact label="Priorität" hideLabel icon={<Flag size={16} />}>
            <UiBadge tone={priorityBadgeTone(task.priority)}>{task.priority}</UiBadge>
          </OperationalFact>
        )}

        {showDeadline && (canManageTaskMeta ? (
          <OperationalFact label="Ziel" icon={<CalendarDays size={16} />}>
            <CustomDatePicker
              value={task.deadline || ""}
              disabled={pending}
              className="h-8 w-36 text-sm"
              aria-label="Zieltermin ändern"
              onChange={(deadline) => onUpdate({ deadline })}
            />
          </OperationalFact>
        ) : (
          <OperationalFact label="Ziel" icon={<CalendarDays size={16} />}>{formatDate(task.deadline, { includeYear: true })}</OperationalFact>
        ))}

        {subIssuesKnown && directSubIssues.length > 0 && (
          <SubIssueProgress completed={completedSubIssues} total={directSubIssues.length} />
        )}
      </div>
    </header>
  );
}
