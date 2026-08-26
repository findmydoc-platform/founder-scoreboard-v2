"use client";

import { SiGithub } from "@icons-pack/react-simple-icons";
import {
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  ExternalLink,
} from "lucide-react";
import { useId, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { TaskChildProgress } from "@/features/tasks/atoms/task-child-progress";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { TaskTypeIcon } from "@/features/tasks/atoms/task-type-indicator";
import { taskPlanningAttentionSignals, type TaskAttentionSignal } from "@/features/tasks/model/task-attention-signals";
import { directChildPluralLabel, taskChildProgress } from "@/features/tasks/model/task-card-presentation";
import { dateRange, taskAssigneeLabel } from "@/lib/display";
import { hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus, priorityBadgeTone } from "@/lib/status";
import type { Task, TaskBlocker, TaskRelation, TaskStatus } from "@/lib/types";
import { UiBadge, type UiTone } from "@/shared/atoms/ui-primitives";
import { CustomActionMenu } from "@/shared/molecules/custom-action-menu";

const taskCardControlSelector = "a, button, input, select, textarea, [role='menuitem'], [data-task-card-interactive='true']";

function isTaskCardControlClick(event: MouseEvent<HTMLElement>) {
  return event.target instanceof Element && Boolean(event.target.closest(taskCardControlSelector));
}

function taskGitHubIssueReference(task: Task) {
  const issueUrl = task.githubIssueUrl || task.issueUrl;
  if (!issueUrl) return null;

  try {
    const url = new URL(issueUrl);
    if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
    const issueNumber = String(task.githubIssueNumber || task.issueNumber || url.pathname.match(/\/issues\/(\d+)/)?.[1] || "")
      .replace(/^#/u, "")
      .trim();
    const repository = task.githubRepo.split("/").at(-1)?.trim() || "GitHub";
    return {
      href: url.toString(),
      label: issueNumber ? `${repository} #${issueNumber}` : `${repository} · GitHub`,
    };
  } catch {
    return null;
  }
}

function TaskCardGitHubLink({ task }: { task: Task }) {
  if (task.taskType === "epic" || task.taskType === "initiative") return null;
  const issue = taskGitHubIssueReference(task);
  if (!issue) return null;

  return (
    <a
      href={issue.href}
      target="_blank"
      rel="noreferrer"
      draggable={false}
      className="coarse-touch-target mt-2 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-sm text-[11px] font-medium text-slate-500 underline-offset-2 transition hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:min-h-0"
      aria-label={`GitHub Issue ${issue.label} in einem neuen Tab öffnen`}
    >
      <SiGithub size={13} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{issue.label}</span>
      <ExternalLink size={11} className="shrink-0 opacity-70" aria-hidden="true" />
    </a>
  );
}

function childStatusPresentation(status: TaskStatus) {
  if (status === "Erledigt") {
    return {
      Icon: CircleCheck,
      iconClassName: "text-emerald-500",
      labelClassName: "text-emerald-700",
    };
  }
  if (status === "In Arbeit") {
    return {
      Icon: CircleDot,
      iconClassName: "text-blue-600",
      labelClassName: "text-blue-700",
    };
  }
  if (status === "Review") {
    return {
      Icon: CircleDot,
      iconClassName: "text-violet-600",
      labelClassName: "text-violet-700",
    };
  }
  if (status === "Nacharbeit" || status === "Pausiert") {
    return {
      Icon: CircleDot,
      iconClassName: "text-amber-600",
      labelClassName: "text-amber-700",
    };
  }
  if (status === "Blockiert") {
    return {
      Icon: CircleAlert,
      iconClassName: "text-rose-600",
      labelClassName: "text-rose-700",
    };
  }
  return {
    Icon: Circle,
    iconClassName: "text-slate-400",
    labelClassName: "text-slate-500",
  };
}

function TaskCardChildRollup({
  task,
  childItems,
  onOpenTask,
}: {
  task: Task;
  childItems: Task[];
  onOpenTask: (taskId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const generatedId = useId().replaceAll(":", "");
  const listId = `task-card-children-${generatedId}`;
  const { completed, percentage, total, unfinished } = taskChildProgress(childItems);
  const plural = directChildPluralLabel(task.taskType);
  const completedWithOpenChildren = normalizeStatus(task.status) === "Erledigt" && unfinished > 0;
  const sortedChildren = [...childItems].sort((first, second) => {
    const firstDone = normalizeStatus(first.status) === "Erledigt";
    const secondDone = normalizeStatus(second.status) === "Erledigt";
    if (firstDone !== secondDone) return firstDone ? 1 : -1;
    return first.order - second.order;
  });

  if (!total) return null;

  return (
    <div className="mt-2.5">
      <TaskChildProgress completed={completed} label={plural} percentage={percentage} total={total} />
      {completedWithOpenChildren && (
        <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
          <CircleAlert size={11} aria-hidden="true" />
          {unfinished === 1 ? "1 Kind noch offen" : `${unfinished} Kinder noch offen`}
        </p>
      )}
      <button
        type="button"
        draggable={false}
        aria-expanded={isExpanded}
        aria-controls={listId}
        aria-label={`${plural} ${isExpanded ? "einklappen" : "anzeigen"}: ${unfinished} offen, ${completed} erledigt`}
        onClick={() => setIsExpanded((current) => !current)}
        onDragStart={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        className="mt-2 flex min-h-6 w-full items-center justify-between gap-2 rounded-sm border border-transparent py-1 text-left font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px]">
          <Circle size={10} className="shrink-0 text-slate-300" aria-hidden="true" />
          <span className="tabular-nums">{unfinished} offen</span>
          <span aria-hidden="true">·</span>
          <CircleCheck size={10} className="shrink-0 text-emerald-500" aria-hidden="true" />
          <span className="tabular-nums">{completed} erledigt</span>
        </span>
        {isExpanded ? (
          <ChevronUp size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-slate-300" aria-hidden="true" />
        )}
      </button>
      {isExpanded && (
        <ul id={listId} className="mt-1">
          {sortedChildren.map((child, index) => {
            const status = normalizeStatus(child.status);
            const isDone = status === "Erledigt";
            const previousStatus = index > 0 ? normalizeStatus(sortedChildren[index - 1].status) : null;
            const showDoneDivider = isDone && previousStatus !== "Erledigt";
            const { Icon, iconClassName, labelClassName } = childStatusPresentation(status);

            return (
              <li
                key={child.id}
                className={showDoneDivider ? "mt-1 border-t border-slate-200 pt-1" : undefined}
              >
                <TaskReferenceLink
                  task={child}
                  onOpenTask={onOpenTask}
                  showIcon={false}
                  layout="flex"
                  draggable={false}
                  onDragStart={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  aria-label={`${child.title}, Status ${status}`}
                  className={`group/direct-child min-w-0 items-center gap-2 rounded-sm px-1 py-1.5 hover:bg-slate-50 hover:no-underline ${
                    isDone ? "text-slate-400 hover:text-slate-600" : "text-slate-700"
                  }`}
                >
                  <Icon size={13} className={`shrink-0 ${iconClassName}`} aria-hidden="true" />
                  <span title={child.title} className="min-w-0 flex-1 truncate text-[11px] font-medium">{child.title}</span>
                  <span className={`shrink-0 text-[10px] font-medium ${labelClassName}`}>{status}</span>
                  <ChevronRight
                    size={13}
                    className="shrink-0 text-slate-300 transition group-hover/direct-child:text-blue-500"
                    aria-hidden="true"
                  />
                </TaskReferenceLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function RelationBadge({ label, count, tone = "slate" }: { label: string; count: number; tone?: Extract<UiTone, "amber" | "blue" | "slate"> }) {
  if (!count) return null;
  return (
    <UiBadge tone={tone} size="xs" className="text-[11px]">
      {label} {count}
    </UiBadge>
  );
}

function TaskCardStatusMenu({
  onStatusChange,
  status,
  statusOptions,
  taskTitle,
}: {
  onStatusChange?: (status: TaskStatus) => void;
  status: string;
  statusOptions?: TaskStatus[];
  taskTitle: string;
}) {
  const currentStatus = normalizeStatus(status);
  const nextStatuses = Array.from(new Set(statusOptions || [])).filter((option) => normalizeStatus(option) !== currentStatus);

  if (!onStatusChange || !nextStatuses.length) return null;

  const triggerTone = (() => {
    if (currentStatus === "In Arbeit") return "!border-blue-200 !bg-blue-50 !text-blue-700 hover:!bg-blue-100";
    if (currentStatus === "Review") return "!border-violet-200 !bg-violet-50 !text-violet-700 hover:!bg-violet-100";
    if (currentStatus === "Nacharbeit" || currentStatus === "Pausiert") return "!border-amber-200 !bg-amber-50 !text-amber-700 hover:!bg-amber-100";
    if (currentStatus === "Blockiert") return "!border-rose-200 !bg-rose-50 !text-rose-700 hover:!bg-rose-100";
    if (currentStatus === "Erledigt") return "!border-emerald-200 !bg-emerald-50 !text-emerald-700 hover:!bg-emerald-100";
    return "!border-slate-200 !bg-slate-50 !text-slate-700 hover:!bg-slate-100";
  })();

  return (
    <div data-task-card-interactive="true" className="mt-2.5 flex min-h-10 items-center justify-between gap-3 border-t border-slate-100 pt-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Status</span>
      <CustomActionMenu
        label={`Status für ${taskTitle} ändern`}
        triggerAriaLabel={`Status für ${taskTitle} ändern`}
        triggerLabel={currentStatus}
        triggerIcon={<CircleDot size={12} aria-hidden="true" />}
        triggerClassName={`h-7 min-h-7 min-w-0 rounded-full px-2.5 text-[11px] ${triggerTone}`}
        triggerButtonProps={{
          draggable: false,
          title: "Status ändern",
          onDragStart: (event) => {
            event.preventDefault();
            event.stopPropagation();
          },
        }}
        groups={[{
          id: "status",
          label: "Status ändern",
          items: nextStatuses.map((option) => ({
            id: option,
            label: option,
            icon: <CircleDot size={15} />,
            onSelect: () => onStatusChange(option),
          })),
        }]}
      />
    </div>
  );
}

type CardRiskSignal = {
  id: string;
  label: string;
  tone: Extract<UiTone, "amber" | "blue" | "red" | "slate" | "white">;
};

function attentionTone(signal: TaskAttentionSignal): CardRiskSignal["tone"] {
  if (signal.kind === "critical") return "red";
  if (signal.kind === "review") return "blue";
  return "amber";
}

function TaskCardRiskBadges({
  task,
  relations,
  allTasks,
  blockers,
  maxVisible = 3,
}: {
  task: Task;
  relations: TaskRelation[];
  allTasks: Task[];
  blockers: TaskBlocker[];
  maxVisible?: number;
}) {
  const relationGroups = taskRelationsFor(task.id, relations);
  const hasOpenWait = hasOpenWaitingRelation(task.id, allTasks, relations);
  const signals = [
    ...taskPlanningAttentionSignals(task, { taskBlockers: blockers, taskRelations: relations, tasks: allTasks })
      .map((signal) => ({ id: signal.id, label: signal.label, tone: attentionTone(signal) })),
    relationGroups.waitsOn.length ? { id: "waits-on", label: `Wartet auf ${relationGroups.waitsOn.length}`, tone: hasOpenWait ? "amber" : "slate" } : null,
    relationGroups.blocks.length ? { id: "blocks", label: `Blockiert ${relationGroups.blocks.length}`, tone: "blue" } : null,
  ].filter((signal): signal is CardRiskSignal => Boolean(signal));

  if (!signals.length) return null;

  const visibleSignals = signals.slice(0, maxVisible);
  const hiddenCount = signals.length - visibleSignals.length;

  return (
    <>
      {visibleSignals.map((signal) => (
        <UiBadge key={signal.id} tone={signal.tone} size="xs" className="text-[11px]">
          {signal.label}
        </UiBadge>
      ))}
      {hiddenCount > 0 && (
        <UiBadge tone="white" size="xs" className="text-[11px]">
          +{hiddenCount}
        </UiBadge>
      )}
    </>
  );
}

export function TaskCard({
  task,
  ownerColor,
  relations,
  allTasks,
  blockers,
  subIssues = [],
  childItems,
  onOpenTask,
  onStatusChange,
  onDragStart,
  onDragEnd,
  statusOptions,
  showParentContext = false,
  isSelected = false,
  isDragging,
}: {
  task: Task;
  ownerColor: string;
  relations: TaskRelation[];
  allTasks: Task[];
  blockers: TaskBlocker[];
  subIssues?: Task[];
  childItems?: Task[];
  onOpenTask: (taskId: string) => void;
  onStatusChange?: (status: TaskStatus) => void;
  onDragStart?: (task: Task, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  statusOptions?: TaskStatus[];
  showParentContext?: boolean;
  isSelected?: boolean;
  isDragging?: boolean;
}) {
  const showPriority = task.priority === "P0" || task.priority === "P1";
  const directChildren = childItems || subIssues || [];
  const directParentType = task.taskType === "initiative" ? "Epic" : task.taskType === "deliverable" ? "Initiative" : null;
  const directParent = directParentType && task.parentTaskId ? allTasks.find((candidate) => candidate.id === task.parentTaskId) : null;
  const draggedRef = useRef(false);

  return (
    <article
      draggable={Boolean(onDragStart)}
      onClick={(event) => {
        if (draggedRef.current || event.defaultPrevented || isTaskCardControlClick(event)) return;
        onOpenTask(task.id);
      }}
      onDragStart={(event) => {
        draggedRef.current = true;
        onDragStart?.(task, event);
      }}
      onDragEnd={() => {
        onDragEnd?.();
        requestAnimationFrame(() => {
          draggedRef.current = false;
        });
      }}
      className={`min-w-0 max-w-full overflow-hidden border bg-white p-3 transition ${
        isDragging ? "scale-[0.98] cursor-grabbing border-dashed opacity-55 ring-2 ring-blue-200" : onDragStart ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${isSelected ? "border-blue-200 opacity-75 ring-1 ring-blue-200" : "border-slate-200"} rounded-md border-l-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]`}
      style={{ borderLeftColor: ownerColor }}
    >
      <TaskReferenceLink
        task={task}
        onOpenTask={onOpenTask}
        showIcon={false}
        className="min-w-0 max-w-full text-left text-sm font-semibold leading-snug text-slate-900 hover:text-blue-700"
      >
        <TaskTypeIcon taskType={task.taskType} size={15} className="mt-0.5" />
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{task.title}</span>
      </TaskReferenceLink>
      {showParentContext && directParentType && (
        <p className="mt-1.5 flex min-w-0 items-center gap-1 text-[11px] font-medium text-slate-500">
          <span className="shrink-0 text-slate-400">{directParentType} ·</span>
          <span className={`truncate ${directParent ? "" : "text-amber-700"}`} title={directParent?.title}>
            {directParent?.title || `Ohne ${directParentType}`}
          </span>
        </p>
      )}
      <TaskCardGitHubLink task={task} />
      <div className="mt-2 flex flex-wrap gap-1.5 empty:hidden">
        {showPriority && (
          <UiBadge tone={priorityBadgeTone(task.priority)} size="xs" className="text-[11px]">
            {task.priority}
          </UiBadge>
        )}
        <TaskCardRiskBadges task={task} relations={relations} allTasks={allTasks} blockers={blockers} maxVisible={2} />
      </div>
      <TaskCardChildRollup task={task} childItems={directChildren} onOpenTask={onOpenTask} />
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2 text-xs text-slate-500">
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: ownerColor }} />
          <span className="truncate">{taskAssigneeLabel(task)}</span>
        </span>
        <span className="shrink-0">{task.targetDate || dateRange(task)}</span>
      </div>
      <TaskCardStatusMenu
        onStatusChange={onStatusChange}
        status={task.status}
        statusOptions={statusOptions}
        taskTitle={task.title}
      />
    </article>
  );
}
