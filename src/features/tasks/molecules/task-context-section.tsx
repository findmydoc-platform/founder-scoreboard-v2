"use client";

import { focusStatusLabel, formatDate as formatDisplayDate } from "@/lib/display";
import type { DecisionTaskLink, PlanningData, TaskFocusItem } from "@/lib/types";

type LinkedDecision = {
  link: DecisionTaskLink;
  decision?: PlanningData["decisions"][number];
};

function formatDate(value: string) {
  return formatDisplayDate(value, { includeYear: true });
}

type Props = {
  linkedFocusItems: TaskFocusItem[];
  linkedDecisions: LinkedDecision[];
  profileName: (profileId: string) => string;
};

export function TaskContextSection({ linkedFocusItems, linkedDecisions, profileName }: Props) {
  return (
    <>
      <div>
        <h3 className="text-sm font-semibold text-slate-950">Fokus-Kontext</h3>
        <div className="mt-2 grid gap-2">
          {linkedFocusItems.length ? linkedFocusItems.map((item) => (
            <article key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">{profileName(item.profileId)} · {formatDate(item.focusDate)}</span>
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{focusStatusLabel(item.status)}</span>
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-500">{item.nextStep || "Kein nächster Schritt hinterlegt."}</div>
            </article>
          )) : (
            <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Diese Aufgabe ist aktuell in keinem Tagesfokus.</div>
          )}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-950">Begründende Decisions</h3>
        <div className="mt-2 grid gap-2">
          {linkedDecisions.length ? linkedDecisions.map(({ link, decision }) => (
            <article key={link.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <div className="font-semibold text-slate-800">{decision?.title}</div>
              <div className="mt-1 text-xs text-slate-500">{decision?.status || "Decision"} · {link.note || "Keine Notiz hinterlegt."}</div>
            </article>
          )) : (
            <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Noch keine Decision verknüpft.</div>
          )}
        </div>
      </div>
    </>
  );
}
