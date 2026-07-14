"use client";

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { classNames } from "@/shared/atoms/ui-primitives";

export const taskDetailTabOrder = ["overview", "subIssues", "relationships", "activity"] as const;

export type TaskDetailTabId = (typeof taskDetailTabOrder)[number];
export type TaskDetailTabCount = number | string;

export type TaskDetailTabsProps = {
  value: TaskDetailTabId;
  onValueChange: (value: TaskDetailTabId) => void;
  panels: Readonly<Record<TaskDetailTabId, ReactNode>>;
  counts?: Partial<Record<TaskDetailTabId, TaskDetailTabCount>>;
  ariaLabel?: string;
  className?: string;
  idBase?: string;
  panelClassName?: string;
  tabListClassName?: string;
};

const tabLabels: Record<TaskDetailTabId, string> = {
  overview: "Übersicht",
  subIssues: "Sub-Issues",
  relationships: "Beziehungen",
  activity: "Aktivität",
};

function visibleCount(count: TaskDetailTabCount) {
  return typeof count === "number" && count > 99 ? "99+" : String(count);
}

function tabId(idBase: string, value: TaskDetailTabId) {
  return `${idBase}-tab-${value}`;
}

function panelId(idBase: string, value: TaskDetailTabId) {
  return `${idBase}-panel-${value}`;
}

export function TaskDetailTabs({
  value,
  onValueChange,
  panels,
  counts,
  ariaLabel = "Item-Bereiche",
  className,
  idBase,
  panelClassName,
  tabListClassName,
}: TaskDetailTabsProps) {
  const generatedId = useId();
  const resolvedIdBase = idBase || `task-detail-tabs-${generatedId.replaceAll(":", "")}`;
  const tabRefs = useRef<Partial<Record<TaskDetailTabId, HTMLButtonElement | null>>>({});
  const [rovingState, setRovingState] = useState(() => ({
    value,
    focusedValue: value,
  }));
  const focusedValue = rovingState.value === value ? rovingState.focusedValue : value;

  const setFocusedValue = (nextValue: TaskDetailTabId) => {
    setRovingState({ value, focusedValue: nextValue });
  };

  const focusTab = (nextValue: TaskDetailTabId) => {
    setFocusedValue(nextValue);
    tabRefs.current[nextValue]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentValue: TaskDetailTabId) => {
    const currentIndex = taskDetailTabOrder.indexOf(currentValue);
    let nextValue: TaskDetailTabId | null = null;

    if (event.key === "ArrowLeft") {
      nextValue = taskDetailTabOrder[Math.max(0, currentIndex - 1)];
    } else if (event.key === "ArrowRight") {
      nextValue = taskDetailTabOrder[Math.min(taskDetailTabOrder.length - 1, currentIndex + 1)];
    } else if (event.key === "Home") {
      nextValue = taskDetailTabOrder[0];
    } else if (event.key === "End") {
      nextValue = taskDetailTabOrder[taskDetailTabOrder.length - 1];
    } else if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      if (value !== currentValue) onValueChange(currentValue);
      return;
    } else {
      return;
    }

    event.preventDefault();
    focusTab(nextValue);
  };

  return (
    <div className={classNames("min-w-0", className)}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        className={classNames(
          "flex min-w-0 overflow-x-auto border-b border-slate-200",
          tabListClassName,
        )}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setRovingState({ value, focusedValue: value });
          }
        }}
      >
        {taskDetailTabOrder.map((tabValue) => {
          const active = tabValue === value;
          const count = counts?.[tabValue];
          const hasCount = count !== undefined && count !== "";
          const label = tabLabels[tabValue];

          return (
            <button
              key={tabValue}
              ref={(node) => {
                tabRefs.current[tabValue] = node;
              }}
              id={tabId(resolvedIdBase, tabValue)}
              type="button"
              role="tab"
              aria-controls={panelId(resolvedIdBase, tabValue)}
              aria-label={hasCount ? `${label} ${String(count)}` : label}
              aria-selected={active}
              tabIndex={tabValue === focusedValue ? 0 : -1}
              data-state={active ? "active" : "inactive"}
              className={classNames(
                "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 border-b-2 px-4 text-sm font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset",
                active
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-950",
              )}
              onFocus={() => setFocusedValue(tabValue)}
              onClick={() => {
                if (!active) onValueChange(tabValue);
              }}
              onKeyDown={(event) => handleKeyDown(event, tabValue)}
            >
              <span aria-hidden="true">{label}</span>
              {hasCount ? (
                <span
                  aria-hidden="true"
                  className={classNames(
                    "inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] leading-4",
                    active ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {visibleCount(count)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        id={panelId(resolvedIdBase, value)}
        role="tabpanel"
        aria-labelledby={tabId(resolvedIdBase, value)}
        tabIndex={0}
        className={classNames(
          "min-w-0 pt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
          panelClassName,
        )}
      >
        {panels[value]}
      </div>
    </div>
  );
}
