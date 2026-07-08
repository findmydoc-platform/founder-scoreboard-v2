"use client";

import { focusStatusLabel, formatDate as formatDisplayDate } from "@/lib/display";
import type { TaskFocusItem } from "@/lib/types";
import { UiBadge, UiEmptyState } from "@/shared/atoms/ui-primitives";

function formatDate(value: string) {
  return formatDisplayDate(value, { includeYear: true });
}

type Props = {
  linkedFocusItems: TaskFocusItem[];
  profileName: (profileId: string) => string;
};

export function TaskContextSection({ linkedFocusItems, profileName }: Props) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-950">Fokus-Kontext</h3>
      <div className="mt-2 grid gap-2">
        {linkedFocusItems.length ? linkedFocusItems.map((item) => (
          <article key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-800">{profileName(item.profileId)} · {formatDate(item.focusDate)}</span>
              <UiBadge tone="blue" size="xs">{focusStatusLabel(item.status)}</UiBadge>
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-500">{item.nextStep || "Kein nächster Schritt hinterlegt."}</div>
          </article>
        )) : (
          <UiEmptyState>Diese Aufgabe ist aktuell in keinem Tagesfokus.</UiEmptyState>
        )}
      </div>
    </div>
  );
}
