"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  normalizeTaskDetailTabs,
  resolveTaskDetailTab,
  type TaskDetailTabId,
} from "@/features/tasks/model/task-detail-tabs-model";
import { classNames } from "@/shared/atoms/ui-primitives";

export { taskDetailTabOrder } from "@/features/tasks/model/task-detail-tabs-model";
export type { TaskDetailTabId } from "@/features/tasks/model/task-detail-tabs-model";
export type TaskDetailTabCount = number | string;

export type TaskDetailTabsProps = {
  value: TaskDetailTabId;
  onValueChange: (value: TaskDetailTabId) => void;
  panels: Readonly<Record<TaskDetailTabId, ReactNode>>;
  availableTabs?: readonly TaskDetailTabId[];
  counts?: Partial<Record<TaskDetailTabId, TaskDetailTabCount>>;
  ariaLabel?: string;
  className?: string;
  idBase?: string;
  panelAside?: ReactNode;
  panelClassName?: string;
  panelLayoutClassName?: string;
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
  availableTabs,
  counts,
  ariaLabel = "Item-Bereiche",
  className,
  idBase,
  panelAside,
  panelClassName,
  panelLayoutClassName,
  tabListClassName,
}: TaskDetailTabsProps) {
  const generatedId = useId();
  const resolvedIdBase = idBase || `task-detail-tabs-${generatedId.replaceAll(":", "")}`;
  const renderedTabs = normalizeTaskDetailTabs(availableTabs);
  const renderedTabsKey = renderedTabs.join(":");
  const resolvedValue = resolveTaskDetailTab(value, renderedTabs);
  const tabRefs = useRef<Partial<Record<TaskDetailTabId, HTMLButtonElement | null>>>({});
  const announcementRef = useRef<HTMLDivElement | null>(null);
  const [rovingState, setRovingState] = useState(() => ({
    value: resolvedValue,
    focusedValue: resolvedValue,
  }));
  const focusedValue = rovingState.value === resolvedValue && renderedTabs.includes(rovingState.focusedValue)
    ? rovingState.focusedValue
    : resolvedValue;

  useEffect(() => {
    if (value === resolvedValue) return;
    if (announcementRef.current) announcementRef.current.textContent = "";
    onValueChange(resolvedValue);
    window.requestAnimationFrame(() => {
      if (announcementRef.current) announcementRef.current.textContent = "Übersicht geöffnet.";
      const tab = tabRefs.current[resolvedValue];
      tab?.focus();
      tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, [onValueChange, renderedTabsKey, resolvedValue, value]);

  const setFocusedValue = (nextValue: TaskDetailTabId) => {
    setRovingState({ value: resolvedValue, focusedValue: nextValue });
  };

  const focusTab = (nextValue: TaskDetailTabId) => {
    setFocusedValue(nextValue);
    const tab = tabRefs.current[nextValue];
    tab?.focus();
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentValue: TaskDetailTabId) => {
    const currentIndex = renderedTabs.indexOf(currentValue);
    let nextValue: TaskDetailTabId | null = null;

    if (event.key === "ArrowLeft") {
      nextValue = renderedTabs[Math.max(0, currentIndex - 1)];
    } else if (event.key === "ArrowRight") {
      nextValue = renderedTabs[Math.min(renderedTabs.length - 1, currentIndex + 1)];
    } else if (event.key === "Home") {
      nextValue = renderedTabs[0];
    } else if (event.key === "End") {
      nextValue = renderedTabs[renderedTabs.length - 1];
    } else if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      if (resolvedValue !== currentValue) onValueChange(currentValue);
      return;
    } else {
      return;
    }

    event.preventDefault();
    focusTab(nextValue);
  };

  const renderedPanel = (
    <div
      id={panelId(resolvedIdBase, resolvedValue)}
      role="tabpanel"
      aria-labelledby={tabId(resolvedIdBase, resolvedValue)}
      tabIndex={0}
      className={classNames(
        "min-w-0 pt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
        panelClassName,
      )}
    >
      {panels[resolvedValue]}
    </div>
  );

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
            setRovingState({ value: resolvedValue, focusedValue: resolvedValue });
          }
        }}
      >
        {renderedTabs.map((tabValue) => {
          const active = tabValue === resolvedValue;
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
              onFocus={(event) => {
                setFocusedValue(tabValue);
                event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}
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

      {panelAside ? (
        <div className={classNames("min-w-0", panelLayoutClassName)}>
          {renderedPanel}
          {panelAside}
        </div>
      ) : renderedPanel}
      <div ref={announcementRef} className="sr-only" aria-live="polite" />
    </div>
  );
}
