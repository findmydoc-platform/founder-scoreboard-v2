"use client";

import { ChevronDown, Eye } from "lucide-react";

export function TestProfileBanner({
  initials,
  label,
  onEnd,
  onOpen,
}: {
  initials: string;
  label: string;
  onEnd: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-tour-id="active-test-profile-banner"
      className="flex h-10 items-center justify-between gap-2 border-b border-emerald-200 bg-emerald-50 px-3 text-sm text-emerald-900 sm:px-4"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex h-9 min-w-0 items-center gap-2 rounded-md px-1.5 font-semibold transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        aria-label={`Aktives Testprofil ${label}. Testprofil wechseln`}
      >
        <Eye size={16} className="shrink-0" aria-hidden="true" />
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-[10px] font-bold text-emerald-800 ring-1 ring-emerald-300">
          {initials}
        </span>
        <span className="truncate"><span className="hidden sm:inline">Testprofil aktiv: </span>{label}</span>
        <ChevronDown size={15} className="shrink-0" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onEnd}
        className="h-9 shrink-0 rounded-md px-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        aria-label="Testprofil beenden und zur eigenen Ansicht zurückkehren"
      >
        Beenden
      </button>
    </div>
  );
}
