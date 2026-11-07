"use client";

import { Info, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "@/shared/hooks/use-anchored-popover";

export function TaskCommentStatusHelp({ label, children, icon: Icon = Info }: { label: string; children: ReactNode; icon?: LucideIcon }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false);
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const close = useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);
  const { rootRef, triggerRef, popoverRef, position } = useAnchoredPopover({ open, onClose: close, gap: 4 });

  function show() {
    cancelClose();
    setOpen(true);
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (!hovered.current && document.activeElement !== triggerRef.current) setOpen(false);
    }, 150);
  }

  function enter() {
    hovered.current = true;
    show();
  }

  function leave() {
    hovered.current = false;
    scheduleClose();
  }

  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [close, open]);

  return (
    <div ref={rootRef} className="inline-flex shrink-0" onMouseEnter={enter} onMouseLeave={leave}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={show}
        onBlur={scheduleClose}
        onClick={show}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
      >
        <Icon size={15} aria-hidden="true" />
      </button>
      {open && position ? createPortal(
        <div
          ref={popoverRef}
          id={id}
          role="tooltip"
          onMouseEnter={enter}
          onMouseLeave={leave}
          style={{ position: "fixed", top: position.top, left: position.left }}
          className="z-[100] grid w-72 max-w-[calc(100vw-24px)] gap-2 rounded-md border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-700 shadow-lg [overflow-wrap:anywhere]"
        >
          {children}
        </div>, document.body,
      ) : null}
    </div>
  );
}
