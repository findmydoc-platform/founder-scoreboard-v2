"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { usePlanningBusinessState } from "@/features/planning/hooks/use-planning-business-state";
import { formatReleaseDate, releaseTitle, type PlatformReleaseRecord } from "../model/platform-release-model";

type Props = {
  compact?: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
};

export function PlatformReleaseSidebarCard({ compact = false, mobile = false, onNavigate }: Props) {
  const planning = usePlanningBusinessState();
  useSyncExternalStore(planning?.subscribe || (() => () => {}), () => planning?.platformReleases().releases || null, () => null);
  const release = planning?.platformReleases().releases[0];
  useEffect(() => { if (planning && planning.platformReleases().readStatus === "not-loaded") void planning.loadPlatformReleases(); }, [planning]);

  if (!release) return null;
  return <PlatformReleaseSidebarCardView release={release} compact={compact} mobile={mobile} onNavigate={onNavigate} />;
}

export function PlatformReleaseSidebarCardView({ release, compact = false, mobile = false, onNavigate }: Props & { release: PlatformReleaseRecord }) {
  const unread = !release.seenAt;
  const href = `/team/platform-releases/${encodeURIComponent(release.version)}`;

  if (compact) {
    return (
      <Link
        href={href}
        data-tour-id="current-platform-release"
        title={`Neu auf der Plattform · ${release.version}`}
        aria-label={`Neu auf der Plattform: ${releaseTitle(release)}`}
        className="relative mx-auto grid h-10 w-10 place-items-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700 transition hover:bg-blue-100"
      >
        <Sparkles size={18} aria-hidden="true" />
        {unread ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-600 ring-2 ring-blue-50" aria-label="Neu" /> : null}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      data-tour-id="current-platform-release"
      onClick={mobile ? onNavigate : undefined}
      className={mobile
        ? "block rounded-lg border border-blue-100 bg-blue-50 px-3 py-3 text-slate-900"
        : "block rounded-xl border border-blue-100 bg-gradient-to-br from-white to-blue-50 p-3 text-slate-900 shadow-sm transition hover:border-blue-200 hover:shadow"}
    >
      <div className="min-w-0">
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 whitespace-nowrap text-sm font-semibold">
            Neu auf der Plattform
            {unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-label="Neu" /> : null}
          </span>
          <ChevronRight size={16} className="shrink-0 text-blue-600" aria-hidden="true" />
        </span>
        <span className="mt-1 block text-xs font-medium leading-4 text-blue-700">{release.version} · {formatReleaseDate(release.publishedAt)}</span>
        <span className="mt-2 block break-words text-sm font-semibold leading-5">{releaseTitle(release)}</span>
        <span className="mt-2 block break-words text-xs leading-4 text-slate-600">{release.summary}</span>
      </div>
    </Link>
  );
}
