"use client";

import { Columns3, FileText, Link2, MessageSquare, PanelRight } from "lucide-react";
import type { DragEvent } from "react";
import { TaskStatusControl } from "@/features/tasks/atoms/task-status-control";
import { taskPlanningAttentionSignals, type TaskAttentionSignal } from "@/features/tasks/model/task-attention-signals";
import { dateRange, taskAssigneeLabel } from "@/lib/display";
import { hasGitHubIssue, hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus, priorityBadgeTone, statusBadgeTone } from "@/lib/status";
import type { Package, Task, TaskBlocker, TaskRelation, TaskStatus } from "@/lib/types";
import { UiBadge, type UiTone } from "@/shared/atoms/ui-primitives";

function cardHexToRgba(hex: string, alpha: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return `rgba(100, 116, 139, ${alpha})`;
  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function GitHubMissingBadge({ compact = false }: { compact?: boolean }) {
  return (
    <UiBadge
      tone="amber"
      size="xs"
      title="Kein GitHub Issue angelegt."
      className={`gap-1 ${compact ? "px-1.5 text-[10px]" : "text-[11px]"}`}
    >
      Kein Issue
    </UiBadge>
  );
}

export function GitHubSyncStatusBadge({ task, compact = false }: { task: Task; compact?: boolean }) {
  if (!hasGitHubIssue(task)) return <GitHubMissingBadge compact={compact} />;
  if (task.githubSyncStatus === "pending") {
    return (
      <UiBadge tone="amber" size="xs" className={`gap-1 ${compact ? "px-1.5 text-[10px]" : "text-[11px]"}`}>
        Sync läuft
      </UiBadge>
    );
  }
  if (task.githubSyncStatus === "failed") {
    return (
      <UiBadge tone="red" size="xs" className={`gap-1 ${compact ? "px-1.5 text-[10px]" : "text-[11px]"}`}>
        Sync fehlgeschlagen
      </UiBadge>
    );
  }
  if (task.githubSyncStatus !== "synced") {
    return (
      <UiBadge tone="blue" size="xs" className={`gap-1 ${compact ? "px-1.5 text-[10px]" : "text-[11px]"}`}>
        GitHub offen
      </UiBadge>
    );
  }
  return null;
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

function githubRiskSignal(task: Task): CardRiskSignal | null {
  if (!hasGitHubIssue(task)) return { id: "github-missing", label: "Kein Issue", tone: "amber" };
  if (task.githubSyncStatus === "pending") return { id: "github-pending", label: "Sync läuft", tone: "amber" };
  if (task.githubSyncStatus === "failed") return { id: "github-failed", label: "Sync fehlgeschlagen", tone: "red" };
  if (task.githubSyncStatus !== "synced") return { id: "github-open", label: "GitHub offen", tone: "blue" };
  return null;
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
    githubRiskSignal(task),
    ...taskPlanningAttentionSignals(task, { taskBlockers: blockers, taskRelations: relations, tasks: allTasks })
      .filter((signal) => signal.id !== "sync-failed")
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
  pack,
  ownerColor,
  relations,
  allTasks,
  blockers,
  statusOptions,
  statusDisabled = false,
  showEffort = true,
  showDescription = true,
  showOpenButton = true,
  showStatus = false,
  showStatusControl = false,
  onOpen,
  onStatusChange,
  onDragStart,
  onDragEnd,
  isSelected = false,
  isDragging,
}: {
  task: Task;
  pack?: Package;
  ownerColor: string;
  relations: TaskRelation[];
  allTasks: Task[];
  blockers: TaskBlocker[];
  statusOptions: TaskStatus[];
  statusDisabled?: boolean;
  showEffort?: boolean;
  showDescription?: boolean;
  showOpenButton?: boolean;
  showStatus?: boolean;
  showStatusControl?: boolean;
  onOpen: (task: Task) => void;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  onDragStart?: (task: Task, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  isSelected?: boolean;
  isDragging?: boolean;
}) {
  const normalized = normalizeStatus(task.status);

  return (
    <article
      draggable={Boolean(onDragStart)}
      onDragStart={(event) => onDragStart?.(task, event)}
      onDragEnd={onDragEnd}
      className={`min-w-0 max-w-full overflow-hidden rounded-lg border bg-white p-3 shadow-sm transition ${
        isDragging ? "scale-[0.98] cursor-grabbing border-dashed opacity-55 ring-2 ring-blue-200" : onDragStart ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      } ${isSelected ? "border-blue-200 opacity-75 ring-1 ring-blue-200" : "border-slate-200"}`}
      style={{
        borderLeftColor: ownerColor,
        boxShadow: `inset 4px 0 0 ${ownerColor}, 0 1px 3px ${cardHexToRgba(ownerColor, 0.18)}`,
        background: `linear-gradient(90deg, ${cardHexToRgba(ownerColor, 0.13)}, #ffffff 34%)`,
      }}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpen(task)}
          className="min-w-0 max-w-full text-left text-sm font-semibold leading-snug text-slate-900 hover:text-blue-700"
        >
          <span className="inline-flex min-w-0 max-w-full items-start gap-1.5">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{task.title}</span>
          </span>
        </button>
        {showOpenButton && (
          <button
            type="button"
            onClick={() => onOpen(task)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Aufgabe öffnen"
          >
            <PanelRight size={15} />
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {showStatus && (
          <UiBadge tone={statusBadgeTone(normalized)} size="xs" className="text-[11px]">
            {normalized}
          </UiBadge>
        )}
        <UiBadge tone={priorityBadgeTone(task.priority)} size="xs" className="text-[11px]">
          {task.priority}
        </UiBadge>
        {showEffort && (
          <UiBadge size="xs" className="text-[11px]">
            {task.hours}h
          </UiBadge>
        )}
        <TaskCardRiskBadges task={task} relations={relations} allTasks={allTasks} blockers={blockers} />
      </div>
      {showDescription && (
        <p className="mt-2 min-w-0 line-clamp-2 break-words text-xs leading-5 text-slate-600 [overflow-wrap:anywhere]">{task.description}</p>
      )}
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2 text-xs text-slate-500">
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: ownerColor }} />
          <span className="truncate">{pack?.title || "ohne Initiative"} · {taskAssigneeLabel(task)}</span>
        </span>
        <span className="shrink-0">{dateRange(task)}</span>
      </div>
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2 border-t border-slate-100 pt-2">
        {showStatusControl ? (
          <TaskStatusControl
            status={normalized}
            canChange={!statusDisabled}
            onChange={(status) => onStatusChange(task, status)}
            options={statusOptions}
            selectClassName="h-8 w-32 text-xs"
            compact={statusDisabled}
          />
        ) : (
          <span className="h-8 min-w-0 flex-1" aria-hidden="true" />
        )}
        <div className="flex items-center gap-2 text-slate-400">
          <MessageSquare size={14} />
          <FileText size={14} />
          {hasGitHubIssue(task) && <Link2 size={14} className="text-blue-500" />}
        </div>
      </div>
    </article>
  );
}

export function EmptyColumn() {
  return (
    <div className="grid min-h-72 place-items-center rounded-lg border border-dashed border-blue-200 bg-blue-50/40 px-6 text-center">
      <div>
        <div className="mx-auto grid h-16 w-24 place-items-center rounded-lg border border-blue-100 bg-white text-blue-300">
          <Columns3 size={28} />
        </div>
        <p className="mt-4 text-sm font-medium text-slate-600">Keine Treffer in dieser Spalte.</p>
      </div>
    </div>
  );
}
