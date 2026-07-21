"use client";

import { HelpCircle, MousePointerClick, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { selectActiveProductUpdates } from "@/features/product-updates/model/product-update-selection";

export function PlanningHelpMenu() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const hasActiveProductUpdates = selectActiveProductUpdates(productUpdates).length > 0;

  useEffect(() => {
    const openHelpMenu = () => setOpen(true);
    window.addEventListener("fmd:open-help-menu", openHelpMenu);
    return () => window.removeEventListener("fmd:open-help-menu", openHelpMenu);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        aria-label="Hilfe öffnen"
        title="Hilfe"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tour-id="help-menu-trigger"
      >
        <HelpCircle size={16} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Hilfe"
          className="absolute right-0 top-11 z-50 w-[min(88vw,280px)] rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
        >
          {hasActiveProductUpdates && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new CustomEvent("fmd:open-product-updates"));
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
              window.dispatchEvent(new CustomEvent("fmd:start-feature-tour"));
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
      )}
    </div>
  );
}
