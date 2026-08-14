"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { platformReleaseRequest } from "../model/platform-release-api";
import { formatReleaseDate, type PlatformReleaseRecord } from "../model/platform-release-model";
import { platformReleaseSeed } from "../model/platform-release-seed";

type Props = {
  compact?: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
};

export function PlatformReleaseSidebarCard({ compact = false, mobile = false, onNavigate }: Props) {
  const [release, setRelease] = useState<PlatformReleaseRecord | null>(() => process.env.NODE_ENV === "development" ? platformReleaseSeed[0] : null);

  useEffect(() => {
    let active = true;
    void platformReleaseRequest("/api/team/platform-releases/v1/releases")
      .then(async (response) => response.ok ? response.json() as Promise<{ releases?: PlatformReleaseRecord[] }> : null)
      .then((payload) => {
        if (active && payload?.releases?.[0]) setRelease(payload.releases[0]);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!release) return null;
  const unread = !release.seenAt;
  const href = `/team/platform-releases/${encodeURIComponent(release.version)}`;

  if (compact) {
    return (
      <Link
        href={href}
        data-tour-id="current-platform-release"
        title={`Neu auf der Plattform · ${release.version}`}
        aria-label={`Neu auf der Plattform: ${release.summary}`}
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
        <span className={`mt-2 block text-xs leading-4 text-slate-600 ${mobile ? "line-clamp-3" : "line-clamp-4"}`}>{release.summary}</span>
      </div>
    </Link>
  );
}
