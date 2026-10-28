"use client";

import type { PlanningTaskLifecycleView } from "@/features/planning/model/planning-task-lifecycle";
import type { PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";
import { displaySubmittedValue, taskSubmittedValues, type TaskInputLabels } from "./task-save-notice";

export function TaskLifecycleNotice({ operation, onCheck, labels }: { operation: PlanningTaskLifecycleView; onCheck: (id: string) => Promise<PlanningTaskSaveCheck>; labels?: TaskInputLabels }) {
  if (!["unconfirmed", "blocked", "partiallyConfirmed"].includes(operation.phase)) return null;
  const partial = operation.phase === "partiallyConfirmed";
  const blockedHeadings = { create: "Aufgabe noch nicht erstellt", delete_epic: "Noch nicht gelöscht", withdraw: "Noch nicht zurückgezogen", reject: "Noch nicht abgelehnt" };
  const unknownHeadings = { create: "Erstellung unklar", delete_epic: "Löschung unklar", withdraw: "Zurückziehen unklar", reject: "Ablehnung unklar" };
  const unknownMessages = {
    create: "Ob die Aufgabe erstellt wurde, ist noch unklar.",
    delete_epic: "Ob der Meilenstein gelöscht wurde, ist noch unklar.",
    withdraw: "Ob die Aufgabe zurückgezogen wurde, ist noch unklar.",
    reject: "Ob der Vorschlag abgelehnt wurde, ist noch unklar.",
  };
  const heading = partial ? "Aufgabe erstellt, Freigabe fehlgeschlagen" : operation.phase === "blocked" ? blockedHeadings[operation.kind] : unknownHeadings[operation.kind];
  const fields = operation.kind === "create" ? operation.submitted ? taskSubmittedValues(operation.submitted, labels) : [] : operation.submitted ? [["Aufgabe", operation.submitted.task.title], ["Begründung", operation.submitted.reason]] : [];
  return <UiNotice role="status" tone="info" className="my-4 min-w-0 [overflow-wrap:anywhere]">
    <h2 className="font-semibold text-slate-950">{heading}</h2>
    <p className="mt-2">{partial ? "Die Aufgabe bleibt als Vorschlag erhalten. Prüfe ihre Freigabe separat. Erstelle sie nicht erneut." : operation.phase === "blocked" ? "Zuerst muss eine frühere Änderung geprüft werden. Deine Eingaben bleiben erhalten." : `${unknownMessages[operation.kind]} Deine Eingaben bleiben erhalten. Die Aktion wird nicht automatisch wiederholt.`}</p>
    {operation.checkStatus === "checked" ? <p className="mt-2">{operation.phase === "blocked" ? "Die aktuellen Daten sind geladen." : "Die aktuellen Daten sind geladen. Ob die Änderung vollständig ausgeführt wurde, bleibt unklar."}</p> : null}
    {operation.checkStatus === "unavailable" ? <p className="mt-2">Die aktuellen Daten konnten nicht geladen werden. Das Ergebnis bleibt unklar.</p> : null}
    {operation.checkStatus === "forbidden" ? <p className="mt-2">Kein Zugriff auf diese Daten. Die Eingaben werden ausgeblendet.</p> : null}
    {partial && operation.error ? <p className="mt-2">{operation.error}</p> : null}
    {fields.length ? <details className="mt-3"><summary className="cursor-pointer py-2 font-semibold">Eingaben anzeigen</summary><dl className="mt-2 grid gap-3 whitespace-pre-wrap">{fields.map(([label, value], index) => <div key={index}><dt className="font-semibold">{label}</dt><dd>{displaySubmittedValue(value)}</dd></div>)}</dl></details> : null}
    {!partial ? <UiButton type="button" size="lg" className="mt-3" disabled={operation.checkStatus === "checking"} onClick={() => { void onCheck(operation.id); }}>{operation.checkStatus === "checking" ? "Ergebnis wird geprüft …" : "Ergebnis prüfen"}</UiButton> : null}
  </UiNotice>;
}
