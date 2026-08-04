import type { ReactNode } from "react";

type TaskChildProgressProps = {
  className?: string;
  completed: number;
  label: string;
  leading?: ReactNode;
  percentage: number;
  total: number;
};

export function TaskChildProgress({ className = "", completed, label, leading, percentage, total }: TaskChildProgressProps) {
  if (!total) return null;

  return (
    <span className={`block ${className}`.trim()}>
      <span className="flex items-center justify-between gap-3 text-xs font-medium text-slate-500">
        <span className="flex min-w-0 items-center gap-3">
          {leading ? <span className="shrink-0">{leading}</span> : null}
          <span className="truncate">{completed} von {total} {label} erledigt</span>
        </span>
        <span className="shrink-0 tabular-nums">{percentage}%</span>
      </span>
      <span
        role="progressbar"
        aria-label={`${completed} von ${total} ${label} erledigt`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-slate-100"
      >
        <span className="block h-full rounded-full bg-blue-500" style={{ width: `${percentage}%` }} />
      </span>
    </span>
  );
}
