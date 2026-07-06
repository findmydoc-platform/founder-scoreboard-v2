"use client";

import { RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const dismissedForMs = 24 * 60 * 60 * 1000;
const storageKeyPrefix = "fmd-github-app-reconnect-dismissed-at";

function storageKey(profileId: string) {
  return `${storageKeyPrefix}:${profileId}`;
}

function isRecentDismissed(value: string | null) {
  const timestamp = Number(value || 0);
  return Number.isFinite(timestamp) && timestamp > 0 && Date.now() - timestamp < dismissedForMs;
}

export function GitHubAppReconnectBanner({
  authenticated,
  profileId,
  githubAppConnected,
  busy,
  onConnect,
}: {
  authenticated: boolean;
  profileId: string;
  githubAppConnected: boolean;
  busy: boolean;
  onConnect: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const key = useMemo(() => profileId ? storageKey(profileId) : "", [profileId]);
  const shouldConsiderBanner = authenticated && Boolean(profileId) && githubAppConnected === false;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setDismissed(shouldConsiderBanner && key ? isRecentDismissed(window.localStorage.getItem(key)) : false);
    });
    return () => {
      active = false;
    };
  }, [key, shouldConsiderBanner]);

  if (!shouldConsiderBanner || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    if (key) window.localStorage.setItem(key, String(Date.now()));
  };

  return (
    <section className="px-4 pt-4 lg:px-6" aria-label="GitHub-App verbinden">
      <div className="flex flex-col gap-4 rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white text-amber-700 shadow-sm">
            <RefreshCw size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-950">GitHub-App verbinden</h2>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-700">
              Verbinde GitHub einmal neu, damit Kommentare, Anhänge und GitHub-Aktionen auch nach Reloads direkt funktionieren.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onConnect}
            disabled={busy}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-amber-700 px-3 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={16} />
            {busy ? "GitHub wird geöffnet..." : "GitHub-App verbinden"}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 bg-white px-3 text-sm font-semibold text-amber-800 hover:bg-amber-100"
          >
            <X size={16} />
            Später
          </button>
        </div>
      </div>
    </section>
  );
}
