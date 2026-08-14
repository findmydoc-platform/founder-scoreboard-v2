"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { compareReleaseVersions, formatReleaseDate, isMajorRelease, releaseApplicationNames, releaseQuarter, type PlatformReleaseRecord } from "../model/platform-release-model";

type Props = { releases: PlatformReleaseRecord[] };
type Filter = "all" | "Website" | "Clinic Dashboard" | "other";

export function PlatformReleaseArchive({ releases }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [visibleCount, setVisibleCount] = useState(8);
  const sorted = useMemo(() => [...releases].sort((left, right) => compareReleaseVersions(left.version, right.version)), [releases]);
  const filtered = sorted.filter((release) => {
    const applications = releaseApplicationNames(release);
    const matchesFilter = filter === "all"
      || filter === "other" && applications.some((application) => application !== "Website" && application !== "Clinic Dashboard")
      || applications.includes(filter);
    const searchText = `${release.version} ${release.summary} ${release.manifest.changes.map((change) => `${change.title} ${change.summary}`).join(" ")}`.toLowerCase();
    return matchesFilter && searchText.includes(query.trim().toLowerCase());
  }).slice(0, visibleCount);
  const grouped = filtered.reduce<Map<string, PlatformReleaseRecord[]>>((groups, release) => {
    const quarter = releaseQuarter(release.publishedAt);
    groups.set(quarter, [...(groups.get(quarter) || []), release]);
    return groups;
  }, new Map());

  return (
    <div className="mx-auto max-w-[1120px] px-4 py-6 sm:px-8 lg:py-8">
      <label className="flex h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
        <Search size={19} className="text-slate-400" aria-hidden="true" />
        <span className="sr-only">Releases durchsuchen</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Releases durchsuchen" className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400" />
      </label>

      <div className="scrollbar-hidden mt-5 flex gap-2 overflow-x-auto pb-2" aria-label="Anwendungen filtern">
        {[
          ["all", "Alle"],
          ["Website", "Website"],
          ["Clinic Dashboard", "Clinic Dashboard"],
          ["other", "Weitere Anwendungen"],
        ].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id as Filter)} aria-pressed={filter === id} className={`h-9 shrink-0 rounded-lg border px-4 text-sm font-semibold transition ${filter === id ? "border-blue-100 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-7 space-y-8">
        {[...grouped.entries()].map(([quarter, quarterReleases]) => (
          <section key={quarter} aria-labelledby={`quarter-${quarter.replaceAll(" ", "-")}`}>
            <h2 id={`quarter-${quarter.replaceAll(" ", "-")}`} className="mb-3 text-lg font-semibold text-slate-950">{quarter}</h2>
            <div className="space-y-2.5">
              {quarterReleases.map((release, index) => {
                const major = isMajorRelease(release.version);
                const latest = release.version === sorted[0]?.version;
                return (
                  <Link key={release.version} href={`/team/platform-releases/${encodeURIComponent(release.version)}`} className={`group relative grid gap-3 rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm sm:grid-cols-[185px_minmax(0,1fr)_200px_90px] sm:items-center sm:gap-5 sm:px-5 ${major ? "border-emerald-200 border-l-4 border-l-emerald-500 bg-gradient-to-r from-emerald-50/80 to-white" : latest ? "border-blue-200 bg-blue-50/50" : "border-slate-200 bg-white"}`}>
                    <span>
                      <span className="flex items-center gap-2 text-base font-semibold text-slate-950">
                        {release.version}
                        {major ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Neue Hauptversion</span> : null}
                      </span>
                      <span className="mt-1 block text-sm text-slate-500">{formatReleaseDate(release.publishedAt)}</span>
                    </span>
                    <span className="text-sm font-medium leading-6 text-slate-800">{release.summary}</span>
                    <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-blue-700 sm:block">
                      {releaseApplicationNames(release).map((application) => <span key={application} className="sm:block">{application}</span>)}
                    </span>
                    <span className="flex items-center justify-between gap-2 sm:justify-end">
                      {latest ? <span className="absolute right-10 top-4 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 sm:static">Aktuell</span> : <span />}
                      <ChevronRight size={18} className="ml-auto text-blue-700 transition group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                    {index === 0 && major ? <span className="sr-only">Erster Release dieser Hauptversion</span> : null}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
        {!filtered.length ? <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">Keine passenden Releases gefunden.</div> : null}
      </div>
      {filtered.length < releases.length ? (
        <div className="mt-8 text-center">
          <button type="button" onClick={() => setVisibleCount((count) => count + 8)} className="rounded-lg px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50">Weitere Releases laden</button>
        </div>
      ) : null}
    </div>
  );
}
