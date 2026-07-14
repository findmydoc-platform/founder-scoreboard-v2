"use client";

import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { classNames } from "@/shared/atoms/ui-primitives";
import { useAnchoredPopover } from "@/shared/hooks/use-anchored-popover";

export type CustomActionMenuItem = {
  id: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  disabledReason?: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
};

export type CustomActionMenuGroup = {
  id: string;
  label?: string;
  items: CustomActionMenuItem[];
};

export type CustomActionMenuTriggerButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "className">;

type IndexedAction = {
  group: CustomActionMenuGroup;
  item: CustomActionMenuItem;
  groupIndex: number;
  itemIndex: number;
};

function enabledIndices(actions: IndexedAction[]) {
  return actions.flatMap((action, index) => action.item.disabled ? [] : [index]);
}

export function CustomActionMenu({
  label,
  groups,
  triggerAriaLabel = label,
  triggerLabel,
  triggerIcon,
  triggerClassName,
  triggerButtonProps,
  className,
  menuClassName,
  disabled = false,
  onOpenChange,
}: {
  label: string;
  groups: CustomActionMenuGroup[];
  triggerAriaLabel?: string;
  triggerLabel?: ReactNode;
  triggerIcon?: ReactNode;
  triggerClassName?: string;
  triggerButtonProps?: CustomActionMenuTriggerButtonProps;
  className?: string;
  menuClassName?: string;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const actions = useMemo<IndexedAction[]>(() => (
    groups.flatMap((group, groupIndex) => group.items.map((item, itemIndex) => ({ group, item, groupIndex, itemIndex })))
  ), [groups]);
  const availableIndices = useMemo(() => enabledIndices(actions), [actions]);
  const [activeIndex, setActiveIndex] = useState(() => availableIndices[0] ?? -1);
  const {
    onClick: triggerOnClick,
    onKeyDown: triggerOnKeyDown,
    disabled: triggerDisabled,
    ...restTriggerButtonProps
  } = triggerButtonProps || {};
  const resolvedDisabled = disabled || Boolean(triggerDisabled);

  const closeOnOutside = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);
  const { rootRef, triggerRef, popoverRef, position } = useAnchoredPopover({
    open,
    onClose: closeOnOutside,
    placement: "auto",
  });
  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    onOpenChange?.(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, [onOpenChange, triggerRef]);

  const openMenu = useCallback((nextIndex = availableIndices[0] ?? -1) => {
    if (resolvedDisabled) return;
    setActiveIndex(nextIndex);
    setOpen(true);
    onOpenChange?.(true);
  }, [availableIndices, onOpenChange, resolvedDisabled]);

  const moveActive = useCallback((direction: 1 | -1) => {
    if (!availableIndices.length) return;
    setActiveIndex((current) => {
      const currentPosition = availableIndices.indexOf(current);
      const basePosition = currentPosition < 0 ? 0 : currentPosition;
      const nextPosition = (basePosition + direction + availableIndices.length) % availableIndices.length;
      return availableIndices[nextPosition];
    });
  }, [availableIndices]);

  useEffect(() => {
    if (!open || !position) return;
    const frame = requestAnimationFrame(() => {
      actionRefs.current[activeIndex]?.focus();
      if (activeIndex < 0) popoverRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, open, popoverRef, position]);

  const selectAction = (action: CustomActionMenuItem) => {
    if (action.disabled) return;
    closeMenu(true);
    action.onSelect();
  };

  return (
    <div ref={rootRef} className={classNames("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        {...restTriggerButtonProps}
        type="button"
        disabled={resolvedDisabled}
        aria-label={triggerAriaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => {
          triggerOnClick?.(event);
          if (event.defaultPrevented || resolvedDisabled) return;
          if (open) closeMenu();
          else openMenu();
        }}
        onKeyDown={(event) => {
          triggerOnKeyDown?.(event);
          if (event.defaultPrevented || resolvedDisabled) return;
          if (event.key === "Escape") {
            if (open) closeMenu();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openMenu(availableIndices[0] ?? -1);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(availableIndices.at(-1) ?? -1);
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) closeMenu();
            else openMenu();
          }
        }}
        className={classNames(
          "inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-70",
          !triggerLabel && "w-9 px-0",
          triggerClassName,
        )}
      >
        {triggerIcon || <MoreHorizontal size={16} aria-hidden="true" />}
        {triggerLabel && <span className="min-w-0 truncate">{triggerLabel}</span>}
      </button>
      {open && position && createPortal(
        <div
          ref={popoverRef}
          id={id}
          role="menu"
          aria-label={label}
          aria-orientation="vertical"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeMenu(true);
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveActive(1);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              moveActive(-1);
              return;
            }
            if (event.key === "Home") {
              event.preventDefault();
              setActiveIndex(availableIndices[0] ?? -1);
              return;
            }
            if (event.key === "End") {
              event.preventDefault();
              setActiveIndex(availableIndices.at(-1) ?? -1);
              return;
            }
            if (event.key === "Tab") closeMenu();
          }}
          style={{ top: position.top, left: position.left }}
          className={classNames("fixed z-[120] max-h-[calc(100vh-24px)] w-72 max-w-[calc(100vw-24px)] overflow-y-auto border border-slate-300 bg-white p-1 text-sm shadow-xl shadow-slate-900/10", menuClassName)}
        >
          {groups.map((group, groupIndex) => {
            const groupLabelId = group.label ? `${id}-group-${groupIndex}` : undefined;
            return (
              <div key={group.id} className={classNames(groupIndex > 0 && "mt-1 border-t border-slate-200 pt-1")} role="group" aria-labelledby={groupLabelId}>
                {group.label && <div id={groupLabelId} className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group.label}</div>}
                {group.items.map((item, itemIndex) => {
                  const actionIndex = actions.findIndex((action) => action.groupIndex === groupIndex && action.itemIndex === itemIndex);
                  const active = actionIndex === activeIndex;
                  const reasonId = item.disabled && item.disabledReason ? `${id}-reason-${groupIndex}-${itemIndex}` : undefined;
                  return (
                    <button
                      key={item.id}
                      ref={(node) => {
                        actionRefs.current[actionIndex] = node;
                      }}
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      aria-describedby={reasonId}
                      title={item.disabledReason}
                      tabIndex={active && !item.disabled ? 0 : -1}
                      onClick={() => selectAction(item)}
                      className={classNames(
                        "flex min-h-9 w-full items-start gap-2 px-2.5 py-2 text-left outline-none transition focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-500",
                        item.disabled ? "cursor-not-allowed text-slate-400" : item.tone === "danger" ? "text-red-700 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      {item.icon && <span className="mt-0.5 shrink-0" aria-hidden="true">{item.icon}</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{item.label}</span>
                        {item.disabledReason && <span id={reasonId} className="mt-0.5 block text-xs font-normal text-slate-500">{item.disabledReason}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
