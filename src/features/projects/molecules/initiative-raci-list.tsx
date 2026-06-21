"use client";

import { initiativeRaciRows } from "@/lib/display";
import type { Package, Profile } from "@/lib/types";

type Props = {
  initiative: Package;
  profiles: Profile[];
  className?: string;
};

export function InitiativeRaciList({
  initiative,
  profiles,
  className = "grid gap-1 text-xs text-slate-600",
}: Props) {
  return (
    <div className={className}>
      {initiativeRaciRows(initiative, profiles).map((row) => (
        <div key={row.label} className="flex min-w-0 gap-2">
          <span className="w-4 shrink-0 font-semibold text-blue-700">{row.label}</span>
          <span className="min-w-0 truncate" title={`${row.title}: ${row.value}`}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}
