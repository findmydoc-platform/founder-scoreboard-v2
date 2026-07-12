"use client";

import { Funnel, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { UiButton } from "@/shared/atoms/ui-primitives";
import { useAnchoredPopover } from "@/shared/hooks/use-anchored-popover";

export function ColumnFilterPopover({
  label,
  activeCount = 0,
  onReset,
  children,
}: {
  label: string;
  activeCount?: number;
  onReset?: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const closeWithoutFocusRestore = useCallback(() => setOpen(false), []);
  const { rootRef, triggerRef, popoverRef, position } = useAnchoredPopover({
    open,
    onClose: closeWithoutFocusRestore,
    ignoreOutsideSelector: "[data-custom-control-popover]",
  });

  useEffect(() => {
    if (!open || !position) return;
    const frame = requestAnimationFrame(() => {
      popoverRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, position, popoverRef]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
        className={`relative grid h-8 w-8 place-items-center rounded-md outline-none transition focus:ring-2 focus:ring-blue-100 ${activeCount ? "bg-blue-50 text-blue-700" : "text-slate-400 hover:bg-white hover:text-slate-700"}`}
      >
        <Funnel size={13} aria-hidden="true" />
        {activeCount > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-blue-600 px-1 text-[9px] font-semibold leading-4 text-white">{activeCount}</span>}
      </button>
      {open && position && createPortal(
        <div
          ref={popoverRef}
          id={id}
          role="dialog"
          aria-modal="false"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            close(true);
          }}
          style={{ top: position.top, left: Math.max(12, Math.min(position.left, window.innerWidth - 332)) }}
          className="fixed z-[110] w-80 max-w-[calc(100vw-24px)] rounded-lg border border-slate-200 bg-white p-3 text-sm normal-case tracking-normal shadow-xl shadow-slate-900/10"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="font-semibold text-slate-900">{label}</div>
            {activeCount > 0 && onReset && (
              <UiButton type="button" size="xs" variant="ghost" onClick={onReset}>
                <RotateCcw size={13} />
                Zurücksetzen
              </UiButton>
            )}
          </div>
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}
