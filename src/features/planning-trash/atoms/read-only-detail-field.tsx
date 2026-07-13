import type { ReactNode } from "react";

export function ReadOnlyDetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{children || "Nicht gesetzt"}</dd>
    </div>
  );
}
