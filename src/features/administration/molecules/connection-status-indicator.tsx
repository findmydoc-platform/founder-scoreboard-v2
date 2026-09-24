"use client";

import { Info } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { createPortal } from "react-dom";
import { classNames } from "@/shared/atoms/ui-primitives";
import { useAnchoredPopover } from "@/shared/hooks/use-anchored-popover";

const tones = {
  incomplete: "bg-red-600",
  prepared: "bg-lime-500",
  active: "bg-emerald-700",
  ready: "bg-emerald-600",
} as const;

export function ConnectionStatusIndicator({
  description,
  label,
  status,
}: {
  description: string;
  label: string;
  status: keyof typeof tones;
}) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { rootRef, triggerRef, popoverRef, position } = useAnchoredPopover({
    open,
    onClose: close,
    placement: "auto",
    gap: 8,
  });

  return (
    <div
      ref={rootRef}
      className="inline-flex items-center gap-1.5"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={close}
    >
      <span className={classNames("h-2.5 w-2.5 rounded-full", tones[status])} aria-hidden="true" />
      <span className="sr-only">{label}. {description}</span>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label}. ${description}`}
        aria-describedby={open ? tooltipId : undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
        className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100"
      >
        <Info size={14} aria-hidden="true" />
      </button>
      {open && position && createPortal(
        <div
          ref={popoverRef}
          id={tooltipId}
          role="tooltip"
          style={{ top: position.top, left: position.left }}
          className="pointer-events-none fixed z-[140] w-80 max-w-[calc(100vw-24px)] rounded-md bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-5 text-white shadow-xl shadow-slate-900/20"
        >
          {description}
        </div>,
        document.body,
      )}
    </div>
  );
}
