"use client";

import { HelpCircle, MousePointerClick, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { selectActiveProductUpdates } from "@/features/product-updates/model/product-update-selection";

export function PlanningHelpMenu({ menuItem = false, restoreFocusRef }: { menuItem?: boolean; restoreFocusRef?: RefObject<HTMLElement | null> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useModalDialog<HTMLDivElement>({ open, onClose: () => setOpen(false), manageEnvironment: false, restoreFocusRef: restoreFocusRef || triggerRef });
  const [anchor, setAnchor] = useState({ right: 16, top: 80 });
  const hasActiveProductUpdates = selectActiveProductUpdates(
    productUpdates,
    new Date(),
  ).length > 0;

  useEffect(() => {
    const openHelpMenu = () => setOpen(true);
    window.addEventListener("fmd:open-help-menu", openHelpMenu);
    return () => window.removeEventListener("fmd:open-help-menu", openHelpMenu);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !dialogRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [dialogRef, open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        role={menuItem ? "menuitem" : undefined}
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) setAnchor({ right: Math.max(16, window.innerWidth - rect.right), top: rect.bottom + 8 });
          setOpen(value => !value);
        }}
        className={menuItem ? "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500" : "grid h-9 w-9 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"}
        aria-label="Hilfe öffnen"
        title="Hilfe"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tour-id="help-menu-trigger"
      >
        <HelpCircle size={16} aria-hidden="true" />{menuItem ? <span>Hilfe</span> : null}
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={dialogRef}
          tabIndex={-1}
          style={menuItem ? undefined : { right: anchor.right, top: anchor.top }}
          role="dialog"
          aria-label="Hilfe"
          className="fixed right-4 top-20 z-50 w-[min(88vw,280px)] rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
        >
          {hasActiveProductUpdates && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new CustomEvent("fmd:open-product-updates", { cancelable: true }));
              }}
              data-tour-id="product-updates-menu-link"
              className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition hover:bg-blue-50"
            >
              <Sparkles size={17} className="mt-0.5 shrink-0 text-blue-600" />
              <span>
                <span className="block text-sm font-semibold text-slate-950">Was ist neu</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">Änderungen kurz mit Bildern erklärt</span>
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new CustomEvent("fmd:start-feature-tour", { cancelable: true }));
            }}
            className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition hover:bg-slate-50"
          >
            <MousePointerClick size={17} className="mt-0.5 shrink-0 text-slate-500" />
            <span>
              <span className="block text-sm font-semibold text-slate-950">Geführte Hilfe</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">Neue Bedienung direkt ausprobieren</span>
            </span>
          </button>
        </div>
      , document.body) : null}
    </div>
  );
}
