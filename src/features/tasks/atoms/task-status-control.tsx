"use client";

import { Lock } from "lucide-react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { normalizeStatus, statusBadgeTone } from "@/lib/status";
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
  onChange,
  options,
  selectClassName = "h-9 text-sm",
  status,
}: TaskStatusControlProps) {
  const normalized = normalizeStatus(status);
  const doneLocked = normalized === "Erledigt" && !canChange;
  const reason = lockedReason || (doneLocked ? "Nur CEO kann wieder öffnen." : "Status ist geschützt.");

  if (canChange) {
    return (
      <CustomSelect
        value={normalized}
        onChange={(value) => onChange(value as TaskStatus)}
        className={selectClassName}
        options={options.map((option) => ({ value: option, label: option }))}
        aria-label="Status ändern"
      />
    );
  }

  return (
    <div
      className={classNames(
        "flex min-h-8 min-w-0 items-center gap-2 rounded-md border px-2.5",
        doneLocked ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600",
        compact ? "w-fit" : "w-full justify-between",
        className,
      )}
      title={reason}
    >
      <TaskStatusBadge status={normalized} locked={doneLocked} size="xs" />
      {!compact && (
        <span className="min-w-0 truncate text-xs font-medium">
          {reason}
        </span>
      )}
    </div>
  );
}
