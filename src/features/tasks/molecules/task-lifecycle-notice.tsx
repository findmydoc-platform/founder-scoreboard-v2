"use client";

import type { PlanningTaskLifecycleView } from "@/features/planning/model/planning-task-lifecycle";
import type { PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";
import { displaySubmittedValue, taskSubmittedValues } from "./task-save-notice";

export function TaskLifecycleNotice({ operation, onCheck }: { operation: PlanningTaskLifecycleView; onCheck: (id: string) => Promise<PlanningTaskSaveCheck> }) {
  if (!["unconfirmed", "blocked", "partiallyConfirmed"].includes(operation.phase)) return null;
  const partial = operation.phase === "partiallyConfirmed";
  const heading = partial ? "Aufgabe erstellt, Freigabe fehlgeschlagen" : operation.phase === "blocked" ? "Erstellung wartet" : operation.kind === "create" ? "Erstellung noch nicht bestätigt" : operation.kind === "withdraw" ? "Zurückziehen noch nicht bestätigt" : "Ablehnung noch nicht bestätigt";
  const fields = operation.kind === "create" ? operation.submitted ? taskSubmittedValues(operation.submitted) : [] : operation.submitted ? [["Aufgabe", operation.submitted.task.title], ["Begründung", operation.submitted.reason]] : [];
  return <UiNotice role="status" tone="info" className="my-4 min-w-0 [overflow-wrap:anywhere]">
    <h2 className="font-semibold text-slate-950">{heading}</h2>
    <p className="mt-2">{partial ? "Die Aufgabe wurde gespeichert und bleibt als Vorschlag erhalten. Bitte prüfe ihre Freigabe separat. Erstelle sie nicht erneut." : operation.phase === "blocked" ? "Diese Eingaben bleiben erhalten. Die Erstellung wurde noch nicht gesendet, weil ein vorheriger Vorgang noch offen ist." : "Die Serverbestätigung fehlt. Deine abgesendeten Eingaben bleiben erhalten. Der Vorgang wird nicht automatisch wiederholt."}</p>
    {operation.checkStatus === "checked" ? <p className="mt-2">Die Prüfung hat den Vorgang nicht bestätigt. Auch passende Werte beweisen nicht alle Auswirkungen.</p> : null}
    {operation.checkStatus === "unavailable" ? <p className="mt-2">Der Vorgang bleibt unbestätigt. Sein Ergebnis konnte nicht zuverlässig geprüft werden.</p> : null}
    {operation.checkStatus === "forbidden" ? <p className="mt-2">Kein Zugriff auf diese Daten. Die Eingaben werden ausgeblendet.</p> : null}
    {partial && operation.error ? <p className="mt-2">{operation.error}</p> : null}
    {fields.length ? <details className="mt-3"><summary className="cursor-pointer py-2 font-semibold">Eingaben anzeigen</summary><dl className="mt-2 grid gap-3 whitespace-pre-wrap">{fields.map(([label, value], index) => <div key={index}><dt className="font-semibold">{label}</dt><dd>{displaySubmittedValue(value)}</dd></div>)}</dl></details> : null}
    {!partial ? <UiButton type="button" size="lg" className="mt-3" disabled={operation.checkStatus === "checking"} onClick={() => { void onCheck(operation.id); }}>{operation.checkStatus === "checking" ? "Vorgang wird geprüft …" : "Vorgang prüfen"}</UiButton> : null}
  </UiNotice>;
}
