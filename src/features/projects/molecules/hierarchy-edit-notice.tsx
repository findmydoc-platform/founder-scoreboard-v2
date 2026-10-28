"use client";

import type { HierarchyEditor, EpicDraft } from "../model/hierarchy-state";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";
import { taskSubmittedValues, displaySubmittedValue } from "@/features/tasks/molecules/task-save-notice";

export function HierarchyEditNotice({ view, onCheck, onRefresh, onResave, profiles = [], tasks = [] }: {
  view: ReturnType<HierarchyEditor<EpicDraft>["view"]>;
  profiles?: readonly import("@/lib/types").Profile[];
  tasks?: readonly import("@/lib/types").Task[];
  onCheck: () => void;
  onRefresh?: () => void;
  onResave?: () => void;
}) {
  if (!["unconfirmed", "blocked", "conflict", "partiallyConfirmed", "ended"].includes(view.phase) && !(view.parentConfirmed && view.phase === "rejected")) return null;
  const conflict = view.phase === "conflict";
  const partial = view.phase === "partiallyConfirmed";
  const parentUnconfirmed = view.stage === "parent" && !view.parentConfirmed;
  const contentRejected = view.parentConfirmed && view.phase === "rejected";
  return <UiNotice role="status" tone="warning" className="min-w-0 [overflow-wrap:anywhere]">
    <h2 className="font-semibold">{contentRejected ? "Zuordnung gespeichert, Inhalt nicht gespeichert" : partial ? "Initiative erstellt, Freigabe fehlgeschlagen" : conflict ? "Planungselement wurde geändert" : parentUnconfirmed ? "Zuordnung noch nicht bestätigt" : view.phase === "ended" ? "Sitzung beendet" : "Speicherung noch nicht bestätigt"}</h2>
    <p className="mt-2">{view.error}</p>
    <p className="mt-2">{contentRejected ? "Die bestätigte Zuordnung bleibt erhalten. Deine weiteren Eingaben wurden nicht gespeichert und bleiben im Formular." : partial ? "Die Initiative bleibt als Vorschlag erhalten. Bitte prüfe ihre Freigabe separat. Erstelle sie nicht erneut." : conflict ? "Deine Eingaben bleiben erhalten. Vergleiche den aktuellen Stand und speichere danach bewusst erneut." : parentUnconfirmed ? "Weitere Inhaltsänderungen wurden noch nicht gesendet. Deine Eingaben bleiben erhalten. Die Prüfung liest nur den Serverstand und wiederholt die Zuordnung nicht." : "Deine abgesendeten Eingaben bleiben erhalten. Die Prüfung liest den Serverstand und wiederholt die Änderung nicht."}</p>
    {view.submitted ? <details className="mt-2"><summary className="cursor-pointer py-3 font-semibold">Behaltene Eingaben anzeigen</summary><dl className="grid gap-2 whitespace-pre-wrap">{taskSubmittedValues(view.submitted, {profiles,tasks}).map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{displaySubmittedValue(value)}</dd></div>)}</dl></details> : null}
    {conflict && view.serverTask ? <p className="mt-3">Geladener Serverstand: {view.serverTask.title} · {view.serverTask.description}</p> : null}
    {conflict ? <div className="mt-3 flex flex-wrap gap-2"><UiButton size="lg" onClick={onRefresh || onCheck}>Aktuellen Stand laden</UiButton>{onResave ? <UiButton size="lg" disabled={!view.canResave} onClick={onResave}>Bewusst erneut speichern</UiButton> : null}</div> : !partial && !contentRejected && view.phase !== "ended" ? <UiButton size="lg" className="mt-3" onClick={onCheck}>Vorgang prüfen</UiButton> : null}
  </UiNotice>;
}
