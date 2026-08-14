"use client";

import { SiGithub } from "@icons-pack/react-simple-icons";
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Code2, Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { platformReleaseRequest } from "../model/platform-release-api";
import { platformReleaseReferenceUrl } from "../model/platform-release-manifest";
import { formatReleaseDate, highlightedChanges, type PlatformReleasePlanningLink, type PlatformReleaseRecord } from "../model/platform-release-model";
import { taskDetailHrefWithReturnTo } from "@/features/tasks/model/task-detail-return-navigation";

type Props = {
  release: PlatformReleaseRecord;
  technicalInitiallyOpen?: boolean;
};

function ExternalAnchor({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1.5 text-blue-700 hover:text-blue-900 hover:underline ${className}`}>{children}<ExternalLink size={13} aria-hidden="true" /></a>;
}

function PlanningLinks({ release }: { release: PlatformReleaseRecord }) {
  const returnTo = `/team/platform-releases/${encodeURIComponent(release.version)}`;
  const links = [...new Map(release.planningReferences.flatMap((reference) => reference.taskLinks).map((link) => [link.id, link])).values()];
  const initiatives = links.filter((link) => link.type === "initiative");
  const deliverables = links.filter((link) => link.type === "deliverable");
  const subIssues = links.filter((link) => link.type === "sub_issue");
  const group = (label: string, items: PlatformReleasePlanningLink[]) => items.length ? (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1.5 space-y-1.5">
        {items.map((link) => <Link key={link.id} href={taskDetailHrefWithReturnTo(link.href, returnTo)} className="flex min-w-0 items-start gap-1.5 text-blue-700 hover:underline"><span className="min-w-0 flex-1"><span className="line-clamp-2 block text-sm font-semibold leading-5">{link.title}</span><span className="block truncate text-xs font-medium">#{link.issueNumber || link.id}</span></span><ExternalLink size={12} className="mt-1 shrink-0" aria-hidden="true" /></Link>)}
      </div>
    </div>
  ) : null;
  return (
    <div className="space-y-5 border-t border-slate-200 pt-5">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Verknüpfte Planung</div>
      {group("Initiative", initiatives)}
      {group("Deliverable", deliverables)}
      {subIssues.length ? (
        <details>
          <summary className="cursor-pointer list-none text-sm font-semibold text-blue-700">{subIssues.length} verknüpfte Sub-Issues anzeigen <ChevronDown size={15} className="inline" /></summary>
          <div className="mt-2 space-y-1.5">{subIssues.map((link) => <Link key={link.id} href={taskDetailHrefWithReturnTo(link.href, returnTo)} className="block text-xs font-medium leading-5 text-blue-700 hover:underline">#{link.issueNumber || link.id} {link.title}</Link>)}</div>
        </details>
      ) : null}
      {!links.length ? <p className="text-sm leading-6 text-slate-500">Noch keine Planungszuordnung erkannt.</p> : null}
      <p className="text-xs leading-5 text-slate-400">Über Pull Requests und Issues automatisch zugeordnet</p>
    </div>
  );
}

function ChangeEntry({ release, change }: { release: PlatformReleaseRecord; change: PlatformReleaseRecord["manifest"]["changes"][number] }) {
  const visual = change.visualUrls[0];
  const visualMeta = release.manifest.visuals.find((item) => item.url === visual);
  return (
    <article className={`grid gap-5 border-t border-slate-200 py-7 first:border-t-0 first:pt-0 ${visual ? "md:grid-cols-[minmax(0,1fr)_270px] md:items-center" : ""}`}>
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-blue-700">{change.kind === "feature" ? "Verbesserung" : change.kind === "fix" ? "Fehlerbehebung" : "Technische Pflege"}</div>
        <h3 className="mt-2 text-base font-semibold text-slate-950">{change.title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{change.summary}</p>
      </div>
      {visual ? (
        <figure className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={visual} alt={visualMeta?.altText || change.title} className="aspect-[16/9] h-auto w-full object-cover object-top" referrerPolicy="no-referrer" />
        </figure>
      ) : null}
    </article>
  );
}

function TechnicalDetails({ release }: { release: PlatformReleaseRecord }) {
  const [showAllPullRequests, setShowAllPullRequests] = useState(false);
  const [showCommits, setShowCommits] = useState(false);
  const pullRequests = release.manifest.components.flatMap((component) => component.pullRequests.map((pullRequest) => ({ ...pullRequest, application: component.displayName })));
  const commits = release.manifest.components.flatMap((component) => component.commits.map((commit) => ({ ...commit, application: component.displayName })));
  const visiblePullRequests = showAllPullRequests ? pullRequests : pullRequests.slice(0, 3);
  const boardLink = (repository: string, number: number) => {
    const reference = release.planningReferences.find((item) => item.repository.toLowerCase() === repository.toLowerCase() && item.pullRequestNumber === number);
    return reference?.taskLinks.find((link) => link.type === "sub_issue") || reference?.taskLinks.find((link) => link.type === "deliverable") || null;
  };
  const downloadManifest = () => {
    const blob = new Blob([`${JSON.stringify(release.manifest, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `platform-release-${release.version}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-6 border-t border-slate-200 px-4 py-5 sm:px-5">
      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-[0.08em] text-blue-700">Technische Releases</h4>
        <div className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {release.manifest.components.map((component) => (
            <div key={component.key} className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm">
              <span className="font-semibold text-slate-800">{component.displayName} &nbsp;{release.version}</span>
              <ExternalAnchor href={platformReleaseReferenceUrl(component.release)} className="shrink-0 text-xs font-semibold"><SiGithub size={15} aria-hidden="true" />GitHub Release öffnen</ExternalAnchor>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-[0.08em] text-blue-700">Pull Requests</h4>
        <div className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {visiblePullRequests.map((pullRequest) => {
            const planningLink = boardLink(pullRequest.repository, pullRequest.number);
            return (
              <div key={`${pullRequest.repository}-${pullRequest.number}`} className="grid gap-2 px-3 py-2.5 text-sm sm:grid-cols-[105px_minmax(0,1fr)_auto_auto] sm:items-center">
                <span className="text-xs font-semibold text-blue-700">{pullRequest.application}</span>
                <span className="min-w-0 truncate text-slate-600">{pullRequest.title}</span>
                <ExternalAnchor href={pullRequest.url} className="text-xs font-semibold"><SiGithub size={14} />PR #{pullRequest.number}</ExternalAnchor>
                {planningLink ? <Link href={taskDetailHrefWithReturnTo(planningLink.href, `/team/platform-releases/${encodeURIComponent(release.version)}`)} title={planningLink.title} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-blue-700 hover:underline">Founder Board{planningLink.issueNumber ? ` #${planningLink.issueNumber}` : ""} <ExternalLink size={12} /></Link> : <span className="hidden sm:block" />}
              </div>
            );
          })}
          {pullRequests.length > 3 ? <button type="button" onClick={() => setShowAllPullRequests((open) => !open)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-semibold text-blue-700 hover:bg-blue-50">{showAllPullRequests ? "Weniger Pull Requests anzeigen" : `Alle ${pullRequests.length} Pull Requests anzeigen`}<ChevronRight size={16} className={showAllPullRequests ? "rotate-90" : ""} /></button> : null}
        </div>
      </section>

      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-[0.08em] text-blue-700">Commits</h4>
        <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
          <button type="button" onClick={() => setShowCommits((open) => !open)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-semibold text-blue-700 hover:bg-blue-50">{commits.length} Commits anzeigen<ChevronRight size={16} className={showCommits ? "rotate-90" : ""} /></button>
          {showCommits ? <div className="divide-y divide-slate-100 border-t border-slate-200">{commits.map((commit) => <a key={`${commit.application}-${commit.sha}`} href={commit.url} target="_blank" rel="noreferrer" className="grid gap-1 px-3 py-2 text-xs hover:bg-slate-50 sm:grid-cols-[105px_70px_minmax(0,1fr)]"><span className="font-semibold text-blue-700">{commit.application}</span><code className="text-slate-500">{commit.sha.slice(0, 7)}</code><span className="truncate text-slate-600">{commit.message}</span></a>)}</div> : null}
        </div>
      </section>

      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-[0.08em] text-blue-700">Deployment-Nachweise</h4>
        <div className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {release.manifest.components.map((component) => <div key={component.key} className="grid gap-2 px-3 py-2.5 text-xs sm:grid-cols-[105px_95px_minmax(0,1fr)_auto] sm:items-center"><span className="font-semibold text-blue-700">{component.displayName}</span><span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700"><CheckCircle2 size={14} />Erfolgreich</span><span className="font-mono text-slate-500">Ziel-SHA {component.targetSha.slice(0, 7)}</span><ExternalAnchor href={platformReleaseReferenceUrl(component.deploymentRun)} className="font-semibold">Run öffnen</ExternalAnchor></div>)}
        </div>
      </section>

      <button type="button" onClick={downloadManifest} className="flex w-full items-center justify-between gap-4 rounded-lg border border-slate-200 px-3 py-3 text-left text-sm font-semibold text-blue-700 hover:bg-blue-50">
        <span className="inline-flex items-center gap-2"><Download size={16} />Manifest v2 herunterladen</span>
        <span className="min-w-0 truncate font-mono text-xs font-normal text-slate-500">Digest&nbsp; sha256:{release.manifestDigest.slice(0, 16)}…</span>
      </button>
    </div>
  );
}

export function PlatformReleaseDetail({ release, technicalInitiallyOpen = false }: Props) {
  const [allChangesOpen, setAllChangesOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(technicalInitiallyOpen);
  const highlights = highlightedChanges(release);
  const nonHighlights = release.manifest.changes.filter((change) => !release.manifest.highlights.includes(change.id));

  useEffect(() => {
    if (release.seenAt) return;
    void platformReleaseRequest(`/api/team/platform-releases/v1/releases/${encodeURIComponent(release.version)}/seen`, { method: "POST" }).catch(() => undefined);
  }, [release.seenAt, release.version]);

  return (
    <div className="mx-auto max-w-[1190px] px-4 py-6 sm:px-8 lg:py-8">
      <Link href="/team/platform-releases" className="hidden items-center gap-2 text-sm font-semibold text-blue-700 hover:underline sm:inline-flex"><ArrowLeft size={16} aria-hidden="true" />Zurück zu Plattform-Releases</Link>
      <div className="mt-7 grid gap-10 lg:grid-cols-[215px_minmax(0,1fr)]">
        <aside className="hidden border-r border-slate-200 pr-6 lg:block">
          <div className="text-xs font-medium text-slate-500">Version</div>
          <div className="mt-1 text-xl font-semibold text-slate-950">{release.version}</div>
          <div className="mt-7 text-xs font-medium text-slate-500">Veröffentlicht am</div>
          <div className="mt-1 text-sm font-semibold text-slate-800">{formatReleaseDate(release.publishedAt)}</div>
          <div className="mt-7 space-y-3 border-t border-slate-200 pt-5">
            <div className="text-xs font-medium text-slate-500">Betroffene Anwendungen</div>
            {release.manifest.components.map((component) => <div key={component.key}><ExternalAnchor href={component.productionUrl} className="text-sm font-semibold">{component.displayName}</ExternalAnchor><div className="mt-0.5 truncate text-xs text-slate-500">{new URL(component.productionUrl).host}</div></div>)}
          </div>
          <div className="mt-7"><PlanningLinks release={release} /></div>
        </aside>

        <article className="min-w-0">
          <header className="border-b border-slate-200 pb-8">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-blue-700">
              <span>Plattform-Release {release.version}</span><span className="text-slate-400">•</span><span className="normal-case tracking-normal text-slate-500">{formatReleaseDate(release.publishedAt)}</span>
            </div>
            <h1 className="mt-3 max-w-3xl text-[24px] font-semibold leading-[1.18] tracking-tight text-slate-950 sm:text-4xl sm:leading-tight">{release.summary}</h1>
            <ul className="mt-5 space-y-2 text-sm leading-6 text-slate-600">
              {highlights.slice(0, 6).map((change) => <li key={change.id} className="flex gap-3"><span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" /><span>{change.title}</span></li>)}
            </ul>
          </header>

          <section className="pt-7">
            <h2 className="text-xl font-semibold text-slate-950">Was sich verbessert hat</h2>
            <div className="mt-6">{highlights.slice(0, 3).map((change) => <ChangeEntry key={change.id} release={release} change={change} />)}</div>
          </section>

          <div className="mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button type="button" onClick={() => setAllChangesOpen((open) => !open)} aria-expanded={allChangesOpen} className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left hover:bg-slate-50 sm:px-5">
              <span><span className="block text-sm font-semibold text-blue-800">Alle Änderungen und Fehlerbehebungen anzeigen</span><span className="mt-1 block text-xs text-slate-500">{Math.max(nonHighlights.length, release.manifest.changes.length - 3)} weitere Einträge</span></span>
              <ChevronDown size={18} className={`shrink-0 text-blue-700 transition ${allChangesOpen ? "rotate-180" : ""}`} />
            </button>
            {allChangesOpen ? <div className="border-t border-slate-200 px-4 py-2 sm:px-5">{release.manifest.changes.slice(3).map((change) => <ChangeEntry key={change.id} release={release} change={change} />)}</div> : null}
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button type="button" onClick={() => setTechnicalOpen((open) => !open)} aria-expanded={technicalOpen} className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left hover:bg-slate-50 sm:px-5">
              <span className="flex min-w-0 items-start gap-3"><Code2 size={18} className="mt-0.5 shrink-0 text-blue-700" /><span><span className="block text-sm font-semibold text-slate-950">Technische Details &amp; GitHub</span><span className="mt-1 block text-xs text-slate-500">PRs, Commits, Releases und Deployment-Nachweise</span></span></span>
              <ChevronDown size={18} className={`shrink-0 text-blue-700 transition ${technicalOpen ? "rotate-180" : ""}`} />
            </button>
            {technicalOpen ? <TechnicalDetails release={release} /> : null}
          </div>
        </article>
      </div>
    </div>
  );
}
