"use client";

import { AlertCircle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import type { GitHubUserConnectionState } from "@/features/planning/model/github-app-connection";
import { UiButton } from "@/shared/atoms/ui-primitives";

export function githubConnectionLabel({
  installationAvailable,
  state,
}: {
  installationAvailable: boolean;
  state: GitHubUserConnectionState;
}) {
  if (state === "checking" || state === "unknown") return "Verbindung wird geprüft";
  if (!installationAvailable) return "GitHub App nicht verfügbar";
  if (state === "connected") return "Vollständig verbunden";
  if (state === "reconnect_required") return "Autorenverbindung erneuern";
  if (state === "missing") return "Autorenverbindung fehlt";
  return "Verbindung wird geprüft";
}

export function GitHubConnectionInfo({
  installationAvailable,
  userConnected,
  waitingCommentCount,
  failed,
  busy,
  state,
  open,
  onOpenChange,
  onReconnect,
}: {
  installationAvailable: boolean;
  userConnected: boolean;
  waitingCommentCount: number;
  failed: boolean;
  busy: boolean;
  state?: GitHubUserConnectionState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReconnect: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const effectiveState: GitHubUserConnectionState = state || (userConnected ? "connected" : failed ? "reconnect_required" : "missing");
  const isNeutral = effectiveState === "checking" || effectiveState === "unknown";
  const authorConnected = effectiveState === "connected";
  const authorNeedsAction = effectiveState === "missing" || effectiveState === "reconnect_required";
  const installationProblem = !isNeutral && !installationAvailable;
  const label = githubConnectionLabel({ installationAvailable, state: effectiveState });
  const statusDotClass = isNeutral
    ? "bg-slate-300"
    : installationProblem
      ? "bg-red-500"
      : authorNeedsAction
      ? "bg-amber-500"
      : authorConnected
        ? "bg-emerald-500"
        : "bg-slate-300";

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
    };
    window.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("pointerdown", closeOnOutside);
    return () => {
      window.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [onOpenChange, open]);

  return (
    <div ref={rootRef} className="relative mt-1 flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${statusDotClass}`} aria-hidden="true" />
      <span className={`text-sm font-medium ${installationProblem ? "text-red-700" : authorNeedsAction ? "text-amber-700" : authorConnected ? "text-emerald-700" : "text-slate-500"}`}>
        {label}
      </span>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls="github-connection-details"
        className="grid h-6 w-6 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Verbindungsstatus erklären"
      >
        <Info size={15} aria-hidden="true" />
      </button>

      {open && (
        <section
          id="github-connection-details"
          aria-label="Verbindungsstatus"
          className="fixed inset-x-4 top-24 z-[60] overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-8 sm:w-[310px]"
        >
          <div className="px-4 py-3 font-semibold text-slate-950">Verbindungsstatus</div>
          <div className="grid gap-3 border-t border-slate-100 px-4 py-3">
            <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-2">
              {isNeutral ? (
                <RefreshCw size={17} className="mt-0.5 text-slate-400" aria-hidden="true" />
              ) : installationAvailable ? (
                <CheckCircle2 size={17} className="mt-0.5 text-emerald-600" aria-hidden="true" />
              ) : (
                <AlertCircle size={17} className="mt-0.5 text-red-600" aria-hidden="true" />
              )}
              <div>
                <div className="font-medium text-slate-800">
                  {isNeutral ? "GitHub App wird geprüft" : installationAvailable ? "GitHub App installiert" : "GitHub App nicht verfügbar"}
                </div>
                {installationProblem && (
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Issue-Sync ist gesperrt. Aktion: GitHub-App-Konfiguration und Installation prüfen.
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-2">
              {authorConnected ? (
                <CheckCircle2 size={17} className="mt-0.5 text-emerald-600" aria-hidden="true" />
              ) : (
                <AlertCircle size={17} className={`mt-0.5 ${authorNeedsAction ? "text-amber-600" : "text-slate-400"}`} aria-hidden="true" />
              )}
              <div>
                <div className="font-medium text-slate-800">
                  {authorConnected ? "Autorenkonto verbunden" : authorNeedsAction ? "Autorenkonto nicht verbunden" : "Autorenkonto wird geprüft"}
                </div>
                {authorNeedsAction && (
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {waitingCommentCount > 0
                      ? `${waitingCommentCount} ${waitingCommentCount === 1 ? "Kommentar wartet" : "Kommentare warten"} auf deine Verbindung.`
                      : "Kommentare und Anhänge können nicht unter deinem Namen veröffentlicht werden."}
                  </p>
                )}
              </div>
            </div>
          </div>
          {authorNeedsAction && (
            <div className="border-t border-slate-100 px-4 py-3">
              <UiButton size="sm" variant="blueOutline" disabled={busy} onClick={onReconnect}>
                <RefreshCw size={14} aria-hidden="true" />
                {busy ? "GitHub wird geöffnet..." : effectiveState === "reconnect_required" ? "Verbindung erneuern" : "GitHub verbinden"}
              </UiButton>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
