"use client";

import { ExternalLink, ImageIcon, Link2, Pencil, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { FmdTool } from "@/lib/types";
import { fmdToolCategoryLabel } from "@/features/tools/model/fmd-tools";
import {
  classNames,
  UiBadge,
  UiButton,
} from "@/shared/atoms/ui-primitives";

export function FmdQuickLinkCard({
  tool,
  canEditLinks,
  onEdit,
}: {
  tool: FmdTool;
  canEditLinks: boolean;
  onEdit: (tool: FmdTool) => void;
}) {
  const cardTone = tool.url
    ? "border-blue-100 bg-blue-50/35 hover:border-blue-300 hover:bg-blue-50"
    : "border-amber-200 bg-amber-50/60";
  const content = (
    <div className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-3 sm:grid-cols-[104px_minmax(0,1fr)]">
      <FmdQuickLinkPreviewImage tool={tool} />
      <div className="flex min-w-0 flex-col justify-between gap-4 pr-8">
        <div className="min-w-0">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-950">
            <span className="truncate">{tool.name}</span>
            {tool.url && <ExternalLink size={14} className="shrink-0 text-blue-600 transition group-hover/tool:translate-x-0.5 group-hover/tool:-translate-y-0.5" />}
          </h3>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{tool.description}</p>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <UiBadge tone="white" size="xs" className="max-w-full rounded-md">
            <span className="truncate">{fmdToolCategoryLabel(tool.category)}</span>
          </UiBadge>
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-500">
            <UserRound size={13} className="shrink-0 text-slate-400" />
            <span className="truncate">{tool.owner || "Team"}</span>
          </span>
          {!tool.url && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
              <Link2 size={13} />
              Link fehlt
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <article className={classNames("group/tool relative rounded-md border transition", cardTone)}>
      {tool.url ? (
        <a
          href={tool.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`${tool.name} extern öffnen`}
          className="block min-h-36 min-w-0 rounded-md p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
        >
          {content}
        </a>
      ) : (
        <div className="block min-h-36 min-w-0 p-3">
          {content}
        </div>
      )}

      {canEditLinks && (
        <div className="absolute right-3 top-3 z-10">
          <IconTooltip label="Bearbeiten">
            <UiButton
              type="button"
              onClick={() => onEdit(tool)}
              size="iconXs"
              className="text-slate-600"
              aria-label={`${tool.name} bearbeiten`}
              title="Link bearbeiten"
            >
              <Pencil size={15} />
            </UiButton>
          </IconTooltip>
        </div>
      )}
    </article>
  );
}

function FmdQuickLinkPreviewImage({ tool }: { tool: FmdTool }) {
  const [failedSrc, setFailedSrc] = useState("");
  const src = (tool.previewImageUrl || "").trim();
  const failed = Boolean(src && failedSrc === src);

  if (!src || failed) {
    return (
      <span className={classNames(
        "grid h-24 w-[88px] shrink-0 place-items-center rounded-md border sm:h-28 sm:w-[104px]",
        tool.url ? "border-slate-200 bg-white/80 text-slate-300" : "border-amber-200 bg-white/70 text-amber-300",
      )}>
        <ImageIcon size={22} />
      </span>
    );
  }

  return (
    <span className="block h-24 w-[88px] shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white sm:h-28 sm:w-[104px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}

function IconTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span className="pointer-events-none absolute right-0 top-[-2.25rem] z-10 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white opacity-0 shadow-lg transition group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100">
        {label}
      </span>
    </span>
  );
}
