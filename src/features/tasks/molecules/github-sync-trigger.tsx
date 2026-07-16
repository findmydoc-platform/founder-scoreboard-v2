"use client";

import Image from "next/image";
import type { GitHubUserConnectionState } from "@/features/planning/model/github-app-connection";

export function GitHubSyncTrigger({
  count,
  failedCount,
  installationAvailable,
  connectionState,
  open,
  onOpen,
}: {
  count: number;
  failedCount: number;
  installationAvailable: boolean;
  connectionState: GitHubUserConnectionState;
  open: boolean;
  onOpen: () => void;
}) {
  const isNeutral = connectionState === "checking" || connectionState === "unknown";
  const connectionNeedsAction = connectionState === "missing" || connectionState === "reconnect_required";
  const statusDotClass = isNeutral
    ? "bg-slate-300"
    : !installationAvailable
      ? "bg-red-500"
      : connectionNeedsAction
      ? "bg-amber-500"
      : connectionState === "connected"
        ? "bg-emerald-500"
        : "bg-slate-300";
  const badgeClass = failedCount > 0
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
  const statusText = isNeutral
    ? "Verbindung wird geprüft"
    : !installationAvailable
      ? "GitHub App nicht verfügbar"
      : connectionState === "connected"
      ? "vollständig verbunden"
      : connectionNeedsAction
        ? "Verbindung unvollständig"
        : "Verbindung wird geprüft";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={open}
      aria-label={`GitHub öffnen, ${count} ${count === 1 ? "Aktion" : "Aktionen"}, ${statusText}`}
      title="GitHub"
      className="relative grid h-9 w-9 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-950 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    >
      <Image src="/github-mark.svg" width={19} height={19} alt="" aria-hidden="true" />
      <span className={`absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${statusDotClass}`} aria-hidden="true" />
      {count > 0 && (
        <span className={`absolute -right-2 -top-2 min-w-5 rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none shadow-sm ${badgeClass}`} aria-hidden="true">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
