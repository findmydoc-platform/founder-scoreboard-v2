"use client";

import { ExternalLink, Link2, Pencil, UserRound } from "lucide-react";
import type { ReactNode } from "react";
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
    <>
      <div className="min-w-0 pr-10">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-950">
          <span className="truncate">{tool.name}</span>
          {tool.url && <ExternalLink size={14} className="shrink-0 text-blue-600 transition group-hover/tool:translate-x-0.5 group-hover/tool:-translate-y-0.5" />}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{tool.description}</p>
      </div>

      <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
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
    </>
  );

  return (
    <article className={classNames("group/tool relative rounded-md border transition", cardTone)}>
      {tool.url ? (
        <a
          href={tool.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`${tool.name} extern öffnen`}
          className="flex min-h-40 min-w-0 flex-col justify-between rounded-md p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
        >
          {content}
        </a>
      ) : (
        <div className="flex min-h-40 min-w-0 flex-col justify-between p-4">
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
