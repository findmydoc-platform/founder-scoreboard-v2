"use client";

import { ExternalLink, Link2, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { curatedFmdToolLinks, fmdToolCategoryLabel, maxCuratedFmdToolLinks } from "@/features/tools/model/fmd-tools";
import type { FmdTool } from "@/lib/types";
import { UiBadge, UiEmptyState } from "@/shared/atoms/ui-primitives";

export function FmdToolQuickLinks({
  tools,
  open,
  onToggle,
}: {
  tools: FmdTool[];
  open: boolean;
  onToggle: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const quickLinks = useMemo(
    () => curatedFmdToolLinks(tools),
    [tools],
  );

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target)) onToggle();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onToggle();
    };

    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onToggle]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        aria-label="Kuratierte Links"
        title="Kuratierte Links"
      >
        <Link2 size={16} />
      </button>

      {open && (
        <section className="fixed inset-x-4 top-20 z-50 max-h-[calc(100dvh-6rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[min(92vw,340px)]" role="dialog" aria-label="Kuratierte Links">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-slate-950">Kuratierte Links</h2>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <UiBadge tone="slate" bordered={false}>{quickLinks.length}/{maxCuratedFmdToolLinks}</UiBadge>
              <button
                type="button"
                onClick={onToggle}
                className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                aria-label="Kuratierte Links schließen"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-2 sm:max-h-[360px]">
            {quickLinks.length ? quickLinks.map((tool) => (
              <a
                key={tool.id}
                href={tool.url}
                target="_blank"
                rel="noreferrer"
                className="group flex min-w-0 items-start justify-between gap-3 rounded-md border border-transparent p-2 text-left hover:border-blue-100 hover:bg-blue-50/50 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-950">{tool.name}</span>
                  <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-slate-500">
                    <span className="truncate">{fmdToolCategoryLabel(tool.category)}</span>
                    <span className="h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                    <span className="truncate">{linkHost(tool.url)}</span>
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
      )}
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
