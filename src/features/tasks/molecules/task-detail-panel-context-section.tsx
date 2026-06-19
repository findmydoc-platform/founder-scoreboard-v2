"use client";

import { focusStatusLabel, formatDate } from "@/lib/display";
import type { DecisionTaskLink, PlanningData, TaskFocusItem } from "@/lib/types";
import { UiBadge, UiEmptyState } from "@/shared/atoms/ui-primitives";

type LinkedDecision = {
  link: DecisionTaskLink;
  decision?: PlanningData["decisions"][number];
};

type Props = {
  linkedFocusItems: TaskFocusItem[];
  linkedDecisions: LinkedDecision[];
  profileName: (profileId: string) => string;
};

function decisionStatusLabel(status: "draft" | "open_for_confirmation" | "locked") {
  if (status === "locked") return "Gelockt";
  if (status === "open_for_confirmation") return "Zur Bestätigung offen";
  return "Entwurf";
}

export function TaskDetailPanelContextSection({ linkedFocusItems, linkedDecisions, profileName }: Props) {
  return (
    <>
      <section className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">Fokus-Kontext</h3>
        <div className="mt-3 grid gap-2">
          {linkedFocusItems.length ? linkedFocusItems.map((item) => (
            <article key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">{profileName(item.profileId)} · {formatDate(item.focusDate)}</span>
                <UiBadge tone="blue" size="xs">{focusStatusLabel(item.status)}</UiBadge>
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-500">{item.nextStep || "Kein nächster Schritt hinterlegt."}</div>
            </article>
          )) : (
            <UiEmptyState>
              Diese Aufgabe ist aktuell in keinem Tagesfokus.
            </UiEmptyState>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">Begründende Decisions</h3>
        <div className="mt-3 grid gap-2">
          {linkedDecisions.length ? linkedDecisions.map(({ link, decision }) => (
            <article key={link.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <div className="font-semibold text-slate-800">{decision?.title}</div>
              <div className="mt-1 text-xs text-slate-500">{decision ? decisionStatusLabel(decision.status) : "Decision"} · {link.note || "Keine Notiz hinterlegt."}</div>
            </article>
          )) : (
            <UiEmptyState>
              Noch keine Decision verknüpft.
            </UiEmptyState>
          )}
        </div>
      </section>
    </>
  );
}
