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
import { useId, useState, type DragEvent } from "react";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { taskPlanningAttentionSignals, type TaskAttentionSignal } from "@/features/tasks/model/task-attention-signals";
import { dateRange, taskAssigneeLabel } from "@/lib/display";
import { hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus, priorityBadgeTone } from "@/lib/status";
import type { Task, TaskBlocker, TaskRelation, TaskStatus } from "@/lib/types";
import { UiBadge, type UiTone } from "@/shared/atoms/ui-primitives";

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
  const issue = taskGitHubIssueReference(task);
  if (!issue) return null;

  return (
    <a
      href={issue.href}
      target="_blank"
      rel="noreferrer"
      draggable={false}
      className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-sm text-[11px] font-medium text-slate-500 underline-offset-2 transition hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      aria-label={`GitHub Issue ${issue.label} in einem neuen Tab öffnen`}
    >
      <SiGithub size={13} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{issue.label}</span>
      <ExternalLink size={11} className="shrink-0 opacity-70" aria-hidden="true" />
    </a>
  );
}

function subIssueStatusPresentation(status: TaskStatus) {
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
  if (status === "Nacharbeit") {
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

function TaskCardSubIssueRollup({
  subIssues,
  onOpenTask,
}: {
  subIssues: Task[];
  onOpenTask: (taskId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const generatedId = useId().replaceAll(":", "");
  const listId = `task-card-sub-issues-${generatedId}`;
  const completed = subIssues.filter((item) => normalizeStatus(item.status) === "Erledigt").length;
  const total = subIssues.length;
  const unfinished = total - completed;
  const percentage = total ? Math.round((completed / total) * 100) : 0;
  const sortedSubIssues = [...subIssues].sort((first, second) => {
    const firstDone = normalizeStatus(first.status) === "Erledigt";
    const secondDone = normalizeStatus(second.status) === "Erledigt";
    if (firstDone !== secondDone) return firstDone ? 1 : -1;
    return first.order - second.order;
  });

  if (!total) {
    return <p className="mt-2.5 text-[10px] font-medium text-slate-400">0 Sub-Issues</p>;
  }

  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between gap-3 text-[10px]">
        <span className="font-medium text-slate-500">{completed} von {total} Sub-Issues</span>
        <span className="font-medium tabular-nums text-slate-500">{percentage}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${completed} von ${total} Sub-Issues erledigt`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100"
      >
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${percentage}%` }} />
      </div>
      <button
        type="button"
        draggable={false}
        aria-expanded={isExpanded}
        aria-controls={listId}
        aria-label={`Sub-Issues ${isExpanded ? "einklappen" : "anzeigen"}: ${unfinished} offen, ${completed} erledigt`}
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
          {sortedSubIssues.map((subIssue, index) => {
            const status = normalizeStatus(subIssue.status);
            const isDone = status === "Erledigt";
            const previousStatus = index > 0 ? normalizeStatus(sortedSubIssues[index - 1].status) : null;
            const showDoneDivider = isDone && previousStatus !== "Erledigt";
            const { Icon, iconClassName, labelClassName } = subIssueStatusPresentation(status);

            return (
              <li
                key={subIssue.id}
                className={showDoneDivider ? "mt-1 border-t border-slate-200 pt-1" : undefined}
              >
                <TaskReferenceLink
                  task={subIssue}
                  onOpenTask={onOpenTask}
                  showIcon={false}
                  layout="flex"
                  draggable={false}
                  onDragStart={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  aria-label={`${subIssue.title}, Status ${status}`}
                  className={`group/sub-issue min-w-0 items-center gap-2 rounded-sm px-1 py-1.5 hover:bg-slate-50 hover:no-underline ${
                    isDone ? "text-slate-400 hover:text-slate-600" : "text-slate-700"
                  }`}
                >
                  <Icon size={13} className={`shrink-0 ${iconClassName}`} aria-hidden="true" />
                  <span title={subIssue.title} className="min-w-0 flex-1 truncate text-[11px] font-medium">{subIssue.title}</span>
                  <span className={`shrink-0 text-[10px] font-medium ${labelClassName}`}>{status}</span>
                  <ChevronRight
                    size={13}
                    className="shrink-0 text-slate-300 transition group-hover/sub-issue:text-blue-500"
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
  onOpenTask,
  onDragStart,
  onDragEnd,
  isSelected = false,
  isDragging,
}: {
  task: Task;
  ownerColor: string;
  relations: TaskRelation[];
  allTasks: Task[];
  blockers: TaskBlocker[];
  subIssues?: Task[];
  onOpenTask: (taskId: string) => void;
  onDragStart?: (task: Task, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  isSelected?: boolean;
  isDragging?: boolean;
}) {
  const showPriority = task.priority === "P0" || task.priority === "P1";

  return (
    <article
      draggable={Boolean(onDragStart)}
      onDragStart={(event) => onDragStart?.(task, event)}
      onDragEnd={onDragEnd}
      className={`min-w-0 max-w-full overflow-hidden border bg-white p-3 transition ${
        isDragging ? "scale-[0.98] cursor-grabbing border-dashed opacity-55 ring-2 ring-blue-200" : onDragStart ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      } ${isSelected ? "border-blue-200 opacity-75 ring-1 ring-blue-200" : "border-slate-200"} rounded-md border-l-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]`}
      style={{ borderLeftColor: ownerColor }}
    >
      <TaskReferenceLink
        task={task}
        onOpenTask={onOpenTask}
        showIcon={false}
        className="min-w-0 max-w-full text-left text-sm font-semibold leading-snug text-slate-900 hover:text-blue-700"
      >
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{task.title}</span>
      </TaskReferenceLink>
      <TaskCardGitHubLink task={task} />
      <div className="mt-2 flex flex-wrap gap-1.5 empty:hidden">
        {showPriority && (
          <UiBadge tone={priorityBadgeTone(task.priority)} size="xs" className="text-[11px]">
            {task.priority}
          </UiBadge>
        )}
        <TaskCardRiskBadges task={task} relations={relations} allTasks={allTasks} blockers={blockers} maxVisible={2} />
      </div>
      {task.taskType === "deliverable" && (
        <TaskCardSubIssueRollup subIssues={subIssues} onOpenTask={onOpenTask} />
      )}
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: ownerColor }} />
          <span className="truncate">{taskAssigneeLabel(task)}</span>
        </span>
        <span className="shrink-0">{dateRange(task)}</span>
      </div>
    </article>
  );
}
