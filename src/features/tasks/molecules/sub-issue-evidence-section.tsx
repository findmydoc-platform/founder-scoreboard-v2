"use client";

import { ChevronRight, ExternalLink, GitPullRequest, Globe2, Network } from "lucide-react";
import { SiGithub, SiNotion } from "@icons-pack/react-simple-icons";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import type { SubIssueEvidenceEntry, SubIssueEvidenceGroup } from "@/features/tasks/model/sub-issue-evidence";
import { evidenceLinkPresentation, parseEvidenceUrl } from "@/features/tasks/model/task-evidence-links";
import { classNames } from "@/shared/atoms/ui-primitives";

const statuses = {
  open: { label: "Offen", color: "text-emerald-600", badge: "bg-emerald-50 text-emerald-700" },
  merged: { label: "Gemergt", color: "text-violet-600", badge: "bg-violet-50 text-violet-700" },
  closed: { label: "Geschlossen", color: "text-red-600", badge: "bg-red-50 text-red-700" },
} as const;

function EvidenceEntry({ entry, onOpenTask }: { entry: SubIssueEvidenceEntry; onOpenTask?: (id: string) => void }) {
  const pr = entry.pullRequest;
  const presentation = evidenceLinkPresentation(entry.url);
  const url = parseEvidenceUrl(entry.url);
  const status = pr ? statuses[pr.status] : null;
  const ProviderIcon = presentation.provider === "github" ? SiGithub : presentation.provider === "notion" ? SiNotion : Globe2;
  return (
    <li className="border-t border-slate-100">
      <a href={entry.url} target="_blank" rel="noreferrer"
        aria-label={`${pr ? `Pull Request ${pr.repository} Nummer ${pr.number}: ${pr.title}, Status ${status!.label}` : `${presentation.label}-Nachweis: ${entry.url}`} (öffnet in neuem Tab)`}
        className="grid min-h-14 grid-cols-[2rem_minmax(0,1fr)_1rem] items-start gap-x-3 gap-y-1.5 px-3.5 py-2.5 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 @min-[360px]/evidence:grid-cols-[2rem_minmax(0,1fr)_auto_1rem] @min-[360px]/evidence:items-center">
        <span className="col-start-1 row-start-1 grid h-8 w-8 place-items-center rounded-md border border-slate-200 bg-slate-50">
          {pr ? <GitPullRequest size={18} className={status!.color} aria-hidden="true" /> : <ProviderIcon size={18} aria-hidden="true" />}
        </span>
        <span className="col-start-2 row-start-1 min-w-0">
          <span className="block text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{pr?.title || presentation.label}</span>
          <span className="block text-xs text-slate-500 [overflow-wrap:anywhere]">
            {pr ? `${pr.repository} #${pr.number}` : `${presentation.host}${url?.pathname === "/" ? "" : url?.pathname || ""}`}
          </span>
        </span>
        {status ? <span className={classNames("col-start-2 row-start-2 justify-self-start rounded-full px-2 py-0.5 text-[11px] font-semibold @min-[360px]/evidence:col-start-3 @min-[360px]/evidence:row-start-1", status.badge)}>{status.label}</span> : null}
        <ExternalLink size={15} className="col-start-3 row-start-1 shrink-0 self-center text-slate-400 @min-[360px]/evidence:col-start-4" aria-hidden="true" />
      </a>
      {entry.sources.length > 1 ? (
        <p className="px-3.5 pb-2 text-xs text-slate-500 sm:pl-[58px]">
          Auch zugeordnet:{" "}
          {entry.sources.slice(1).map((source, index) => (
            <span key={source.id}>
              {index ? ", " : ""}
              <TaskReferenceLink task={source} onOpenTask={onOpenTask} showIcon={false} className="text-blue-600 sm:min-h-6">{source.title}</TaskReferenceLink>
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

export function SubIssueEvidenceSection({ count, groups, onOpenTask }: {
  count: number;
  groups: SubIssueEvidenceGroup[];
  onOpenTask?: (id: string) => void;
}) {
  if (!count) return null;
  return (
    <details className="group/evidence @container/evidence overflow-hidden rounded-lg border border-slate-200 bg-white">
      <summary data-tour-id="task-sub-issue-evidence-summary" aria-label={`Nachweise aus Sub-Issues: ${count}`} className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3.5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={18} className="shrink-0 transition-transform group-open/evidence:rotate-90" aria-hidden="true" />
        <span className="min-w-0 flex-1">Nachweise aus Sub-Issues</span>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">{count}</span>
      </summary>
      <ul className="border-t border-slate-100">
        {groups.map((group) => (
          <li key={group.source.id} className="border-t border-slate-100 first:border-t-0">
            <div className="flex min-h-11 items-center gap-3 px-3.5 py-2">
              <Network size={18} className="shrink-0 text-slate-500" aria-hidden="true" />
              <TaskReferenceLink task={group.source} onOpenTask={onOpenTask} showIcon={false} className="text-sm font-medium text-blue-600 sm:min-h-6 [overflow-wrap:anywhere]" />
            </div>
            <ul>{group.entries.map((entry) => <EvidenceEntry key={entry.url} entry={entry} onOpenTask={onOpenTask} />)}</ul>
          </li>
        ))}
      </ul>
    </details>
  );
}
