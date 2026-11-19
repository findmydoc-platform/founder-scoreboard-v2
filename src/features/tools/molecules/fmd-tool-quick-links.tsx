"use client";

import { ExternalLink, ImageIcon, Link2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";
import { fmdToolCategoryLabel } from "@/features/tools/model/fmd-tools";
import { maxHeaderQuickLinks } from "@/lib/planning-header-data";
import type { HeaderDataSlot, HeaderQuickLink } from "@/lib/types";
import { UiBadge, UiEmptyState } from "@/shared/atoms/ui-primitives";

export function FmdToolQuickLinks({
  quickLinks,
  open,
  onToggle,
  onRetry,
  menuItem = false,
  restoreFocusRef,
}: {
  menuItem?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  quickLinks: HeaderDataSlot<HeaderQuickLink[]>;
  open: boolean;
  onToggle: () => void;
  onRetry?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const retainRetryFocus = useCallback((button: HTMLButtonElement | null) => {
    if (!button) return;
    return () => {
      if (button.ownerDocument.activeElement === button) closeRef.current?.focus({ preventScroll: true });
    };
  }, []);
  const dialogRef = useModalDialog<HTMLElement>({ open, onClose: onToggle, manageEnvironment: false, restoreFocusRef: restoreFocusRef || triggerRef });
  const [anchor, setAnchor] = useState({ right: 16, top: 80 });
  const links = quickLinks.data;
  const stale = quickLinks.freshness === "stale";

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !dialogRef.current?.contains(target)) onToggle();
    };

    window.addEventListener("pointerdown", closeOnOutside);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [dialogRef, open, onToggle]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        role={menuItem ? "menuitem" : undefined}
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) setAnchor({ right: Math.max(16, window.innerWidth - rect.right), top: rect.bottom + 8 });
          onToggle();
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={menuItem ? "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500" : "grid h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500"}
        aria-label="Kuratierte Links"
        title="Kuratierte Links"
      >
        <Link2 size={16} aria-hidden="true" />{menuItem ? <span>Kuratierte Links</span> : null}
      </button>

      {open && typeof document !== "undefined" ? createPortal(
        <section ref={dialogRef} tabIndex={-1} style={menuItem ? undefined : { right: anchor.right, top: anchor.top }} className="fixed inset-x-4 top-20 z-50 max-h-[calc(100dvh-6rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl sm:inset-x-auto sm:w-[min(92vw,340px)]" role="dialog" aria-label="Kuratierte Links">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-slate-950">Kuratierte Links</h2>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <UiBadge tone="slate" bordered={false}>{quickLinks.state === "loading" || stale ? "..." : `${links.length}/${maxHeaderQuickLinks}`}</UiBadge>
              <button
                ref={closeRef}
                type="button"
                onClick={onToggle}
                className="grid h-7 w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 place-items-center rounded-md text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                aria-label="Kuratierte Links schließen"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          {stale && quickLinks.state !== "error" ? <p role="status" className="px-4 pt-2 text-xs text-slate-600">Linkdaten werden aktualisiert. Bereits bestätigte Links bleiben sichtbar.</p> : null}
          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-2 sm:max-h-[360px]">
            {quickLinks.state === "loading" ? (
              <UiEmptyState className="px-4 py-8">
                Kuratierte Links werden geladen.
              </UiEmptyState>
            ) : quickLinks.state === "error" ? (
              <UiEmptyState className="px-4 py-8">
                <p>{quickLinks.error || "Kuratierte Links konnten nicht geladen werden."}</p>
                {onRetry ? <button ref={retainRetryFocus} type="button" onClick={onRetry} aria-label="Kuratierte Links erneut laden" className="mt-3 inline-flex min-h-11 items-center rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Erneut laden</button> : null}
              </UiEmptyState>
            ) : links.length ? links.map((tool) => (
              <a
                key={tool.id}
                href={tool.url}
                target="_blank"
                rel="noreferrer"
                className="group flex min-w-0 items-start justify-between gap-3 rounded-md border border-transparent p-2 text-left hover:border-blue-100 hover:bg-blue-50/50 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <span className="flex min-w-0 items-start gap-3">
                  <span className="grid h-10 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 text-slate-300">
                    {tool.previewImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={tool.previewImageUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageIcon size={16} />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-950">{tool.name}</span>
                    <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-slate-500">
                      <span className="truncate">{fmdToolCategoryLabel(tool.category)}</span>
                      <span className="h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                      <span className="truncate">{linkHost(tool.url)}</span>
                    </span>
                  </span>
                </span>
                <ExternalLink size={14} className="mt-0.5 shrink-0 text-blue-600 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            )) : (
              <UiEmptyState className="px-4 py-8">
                Keine kuratierten Links.
              </UiEmptyState>
            )}
          </div>
        </section>
      , document.body) : null}
    </div>
  );
}

function linkHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Externer Link";
  }
}
