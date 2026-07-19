"use client";

import { Lock } from "lucide-react";
import { useId } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { isTaskStatusChange, normalizeStatus, statusBadgeTone } from "@/lib/status";
import type { TaskStatus } from "@/lib/types";
import { classNames, UiBadge } from "@/shared/atoms/ui-primitives";

type TaskStatusBadgeProps = {
  className?: string;
  locked?: boolean;
  size?: "xs" | "sm" | "md";
  status: string;
};

export function TaskStatusBadge({ className, locked = false, size = "xs", status }: TaskStatusBadgeProps) {
  const normalized = normalizeStatus(status);
  return (
    <UiBadge tone={statusBadgeTone(normalized)} size={size} className={classNames("gap-1.5", className)}>
      {locked && <Lock size={12} aria-hidden="true" />}
      {normalized}
    </UiBadge>
  );
}

type TaskStatusControlProps = {
  canChange: boolean;
  className?: string;
  compact?: boolean;
  lockedReason?: string;
  showLockedReason?: boolean;
  onChange: (status: TaskStatus) => void;
  options: TaskStatus[];
  selectClassName?: string;
  status: string;
};

export function TaskStatusControl({
  canChange,
  className,
  compact = false,
  lockedReason,
  showLockedReason = true,
  onChange,
  options,
  selectClassName = "h-9 text-sm",
  status,
}: TaskStatusControlProps) {
  const generatedId = useId().replaceAll(":", "");
  const reasonId = `task-status-locked-reason-${generatedId}`;
  const normalized = normalizeStatus(status);
  const doneLocked = normalized === "Erledigt" && !canChange;
  const reason = lockedReason || (doneLocked ? "Nur CEO kann wieder öffnen." : "Status ist geschützt.");

  if (canChange) {
    return (
      <CustomSelect
        value={normalized}
        onChange={(value) => {
          if (!isTaskStatusChange(normalized, value)) return;
          onChange(normalizeStatus(value));
        }}
        className={selectClassName}
        options={options.map((option) => ({ value: option, label: option }))}
        aria-label="Status ändern"
      />
    );
  }

  if (!showLockedReason) {
    return (
      <div
        role="group"
        aria-label="Status gesperrt"
        aria-describedby={reasonId}
        className={classNames(
          "flex h-10 min-w-32 items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900",
          className,
        )}
      >
        <span>{normalized}</span>
        <Lock size={13} className="shrink-0 text-slate-400" aria-hidden="true" />
        <span id={reasonId} className="sr-only">{reason}</span>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Status gesperrt"
      aria-describedby={reasonId}
      className={classNames(
        "flex min-h-8 min-w-0 items-center gap-2 rounded-md border px-2.5",
        doneLocked ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600",
        compact ? "w-fit max-w-full" : "w-full justify-between",
        className,
      )}
    >
      <TaskStatusBadge status={normalized} locked size="xs" />
      <span
        id={reasonId}
        className={classNames(
          "min-w-0 whitespace-normal text-xs font-medium leading-4",
          compact ? "max-w-56" : "text-right",
        )}
      >
        {reason}
      </span>
    </div>
  );
}
