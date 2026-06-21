"use client";

import { Columns3, FileText, Link2, MessageSquare, PanelRight } from "lucide-react";
import type { DragEvent } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { dateRange, taskOwnerLabel } from "@/lib/display";
import { hasGitHubIssue, hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus, priorityBadgeTone, statusBadgeTone } from "@/lib/status";
import type { Package, Task, TaskRelation, TaskStatus } from "@/lib/types";
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
      title="Nur in der App: noch nicht extern abgelegt."
      className={`gap-1 ${compact ? "px-1.5 text-[10px]" : "text-[11px]"}`}
    >
      Nur in der App
    </UiBadge>
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

export function TaskCard({
  task,
  pack,
  ownerColor,
  relations,
  allTasks,
  statusOptions,
  statusDisabled = false,
  showStatus = false,
  showStatusControl = false,
  onOpen,
  onStatusChange,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  task: Task;
  pack?: Package;
  ownerColor: string;
  relations: TaskRelation[];
  allTasks: Task[];
  statusOptions: TaskStatus[];
  statusDisabled?: boolean;
  showStatus?: boolean;
  showStatusControl?: boolean;
  onOpen: (task: Task) => void;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  onDragStart?: (task: Task, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  const normalized = normalizeStatus(task.status);
  const missingGitHub = !hasGitHubIssue(task);
  const relationGroups = taskRelationsFor(task.id, relations);
  const hasOpenWait = hasOpenWaitingRelation(task.id, allTasks, relations);

  return (
    <article
      draggable={Boolean(onDragStart)}
      onDragStart={(event) => onDragStart?.(task, event)}
      onDragEnd={onDragEnd}
      className={`min-w-0 max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition ${
        isDragging ? "scale-[0.98] cursor-grabbing border-dashed opacity-55 ring-2 ring-blue-200" : onDragStart ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      }`}
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
        <button
          type="button"
          onClick={() => onOpen(task)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
          aria-label="Aufgabe öffnen"
        >
          <PanelRight size={15} />
        </button>
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
        <UiBadge size="xs" className="text-[11px]">
          {task.hours}h
        </UiBadge>
        {missingGitHub && <GitHubMissingBadge />}
        <RelationBadge label="Wartet auf" count={relationGroups.waitsOn.length} tone={hasOpenWait ? "amber" : "slate"} />
        <RelationBadge label="Blockiert" count={relationGroups.blocks.length} tone="blue" />
      </div>
      <p className="mt-2 min-w-0 line-clamp-2 break-words text-xs leading-5 text-slate-600 [overflow-wrap:anywhere]">{task.description}</p>
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2 text-xs text-slate-500">
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: ownerColor }} />
          <span className="truncate">{pack?.title || "ohne Initiative"} · {taskOwnerLabel(task)}</span>
        </span>
        <span className="shrink-0">{dateRange(task)}</span>
      </div>
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2 border-t border-slate-100 pt-2">
        {showStatusControl ? (
          <CustomSelect
            value={normalized}
            onChange={(value) => onStatusChange(task, value as TaskStatus)}
            disabled={statusDisabled}
            options={statusOptions.map((status) => ({ value: status, label: status }))}
            className="h-8 w-32 text-xs"
            aria-label="Status ändern"
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
