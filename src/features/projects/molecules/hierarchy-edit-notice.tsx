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
  const unknown = ["unconfirmed", "blocked"].includes(view.phase);
  return <UiNotice role="status" tone="warning" className="min-w-0 [overflow-wrap:anywhere]">
    <h2 className="font-semibold">{contentRejected ? "Zuordnung gespeichert, weitere Änderungen abgelehnt" : partial ? "Initiative erstellt, Freigabe fehlgeschlagen" : conflict ? "Planungselement wurde geändert" : view.phase === "ended" ? "Sitzung beendet" : view.phase === "blocked" ? "Änderung wartet" : "Speicherstatus unklar"}</h2>
    {!unknown && view.error ? <p className="mt-2">{view.error}</p> : null}
    <p className="mt-2">{contentRejected ? "Die Zuordnung bleibt gespeichert. Deine weiteren Eingaben bleiben im Formular." : partial ? "Die Initiative bleibt als Vorschlag erhalten. Prüfe ihre Freigabe separat. Erstelle sie nicht erneut." : conflict ? "Deine Eingaben bleiben erhalten. Vergleiche die Änderungen, bevor du erneut speicherst." : view.phase === "ended" ? "In dieser Sitzung kannst du nicht mehr speichern." : view.phase === "blocked" ? `${view.parentConfirmed ? "Die Zuordnung ist gespeichert. " : ""}Weitere Änderungen wurden noch nicht gesendet. Zuerst muss eine frühere Änderung geprüft werden. Deine Eingaben bleiben erhalten.` : parentUnconfirmed ? "Ob die Zuordnung gespeichert wurde, ist noch unklar. Weitere Änderungen wurden noch nicht gesendet. Deine Eingaben bleiben erhalten." : view.parentConfirmed ? "Die Zuordnung ist gespeichert. Ob die übrigen Änderungen gespeichert sind, ist noch unklar. Deine Eingaben bleiben erhalten." : "Ob deine Änderungen gespeichert wurden, ist noch unklar. Deine Eingaben bleiben erhalten."}</p>
    {view.submitted ? <details className="mt-2"><summary className="cursor-pointer py-3 font-semibold">Eingaben anzeigen</summary><dl className="grid gap-2 whitespace-pre-wrap">{taskSubmittedValues(view.submitted, {profiles,tasks}).map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{displaySubmittedValue(value)}</dd></div>)}</dl></details> : null}
    {conflict && view.serverTask ? <p className="mt-3">Aktueller Stand: {view.serverTask.title} · {view.serverTask.description}</p> : null}
    {conflict ? <div className="mt-3 flex flex-wrap gap-2"><UiButton size="lg" onClick={onRefresh || onCheck}>Aktuellen Stand laden</UiButton>{onResave ? <UiButton size="lg" disabled={!view.canResave} onClick={onResave}>Erneut speichern</UiButton> : null}</div> : !partial && !contentRejected && view.phase !== "ended" ? <><UiButton size="lg" className="mt-3" onClick={onCheck}>Speicherung prüfen</UiButton><p className="mt-2">Dabei wird nichts erneut gespeichert.</p></> : null}
  </UiNotice>;
}
