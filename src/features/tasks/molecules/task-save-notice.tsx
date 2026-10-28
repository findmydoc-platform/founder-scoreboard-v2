"use client";

import type { PlanningTaskSaveCheck, PlanningTaskSaveView } from "@/features/planning/model/planning-state";
import type { Task } from "@/lib/types";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";

const inputLabels: Partial<Record<keyof Task, string>> = {
  title: "Titel", description: "Kontext", status: "Status", priority: "Priorität",
  problemStatement: "Problem", intendedOutcome: "Zielbild", scopeConstraints: "Umfang & Grenzen",
  acceptanceCriteria: "Abnahmekriterien", evidenceRequired: "Erforderlicher Nachweis", definitionOfDone: "Qualitätsstandard",
  note: "Interne Notiz", fixedDate: "Fixtermin", targetDate: "Zieldatum", dependsOn: "Abhängigkeit",
  evidenceLink: "Nachweis-Link", evidenceLinks: "Nachweis-Links", reviewEvidenceExceptionNote: "Begründung zum Nachweis",
  assignee: "Verantwortung", assigneeId: "Verantwortung", owner: "Verantwortung", ownerId: "Verantwortung",
  reviewOwnerProfileId: "Review-Verantwortung", reviewStatus: "Review-Status", reviewRequestedAt: "Review angefragt",
  scorePoints: "Punkte", scoreFinal: "Bewertung abgeschlossen", sprintId: "Sprint", parentTaskId: "Übergeordnetes Element",
  selfDodChecked: "Qualitätsstandard geprüft", selfEvidenceChecked: "Nachweis geprüft",
  selfDocumentedChecked: "Dokumentation geprüft", selfBlockersChecked: "Blocker geprüft",
};
function submittedValues(patch: Readonly<Partial<Task>>) {
  const values: [string, unknown][] = Object.entries(inputLabels).filter(([key]) => Object.hasOwn(patch, key)).map(([key, label]) => [label!, patch[key as keyof Task]]);
  if (patch.strategy) values.push(["Strategisches Ziel", patch.strategy.goal], ["Erfolgskriterien", patch.strategy.successCriteria], ["Strategischer Umfang", patch.strategy.scopeConstraints]);
  if (patch.raciAssignments) values.push(["Beteiligung", patch.raciAssignments.map(item => `${item.profileId}: ${item.role}`).join("\n")]);
  return values;
}
function displayValue(value: unknown) {
  if (value === true) return "Ja";
  if (value === false) return "Nein";
  if (Array.isArray(value)) return value.join("\n") || "Leer";
  return value === null || value === undefined || value === "" ? "Leer" : String(value);
}

export function TaskSaveNotice({ taskTitle, saves, onCheck }: {
  taskTitle: string;
  saves: readonly PlanningTaskSaveView[];
  onCheck?: () => Promise<PlanningTaskSaveCheck>;
}) {
  if (!saves.some(save => save.phase === "unconfirmed")) return null;
  const checkStatus = saves[0].checkStatus;
  return <UiNotice tone="info" role="status" className="my-4 min-w-0 [overflow-wrap:anywhere]">
    <h2 className="font-semibold text-slate-950">Speicherbestätigung ausstehend</h2>
    <p className="mt-1">{taskTitle}: Die Antwort auf deine Speicherung fehlt. Deine abgesendeten Eingaben bleiben erhalten. Weitere Änderungen an dieser Aufgabe warten.</p>
    {checkStatus === "checked" ? <p className="mt-2">Serverstand geladen. Auch passende Feldwerte bestätigen nicht alle Auswirkungen. Die Speicherung bleibt unbestätigt.</p> : null}
    {checkStatus === "unavailable" ? <p className="mt-2">Der Serverstand konnte nicht geladen werden. Die Speicherung bleibt unbestätigt.</p> : null}
    {checkStatus === "forbidden" ? <p className="mt-2">Kein Zugriff auf die Aufgabe. Eingaben und Serverstand werden ausgeblendet. Die Speicherung bleibt unbestätigt.</p> : null}
    {saves.map((save, index) => save.submitted ? <details className="mt-3" key={index}>
      <summary className="cursor-pointer py-2 font-semibold">{save.phase === "blocked" ? "Wartende Eingaben anzeigen" : "Abgesendete Eingaben anzeigen"}</summary>
      {save.phase === "blocked" ? <p>Diese Änderung wurde noch nicht gesendet.</p> : null}
      <dl className="mt-2 grid gap-3 whitespace-pre-wrap">{submittedValues(save.submitted).map(([label, value], field) => <div key={field}><dt className="font-semibold">{label}</dt><dd>{displayValue(value)}</dd></div>)}</dl>
    </details> : null)}
    {saves[0].serverTask && saves[0].submitted ? <details className="mt-3">
      <summary className="cursor-pointer py-2 font-semibold">Aktuellen Serverstand anzeigen</summary>
      <dl className="mt-2 grid gap-3 whitespace-pre-wrap">{submittedValues(Object.fromEntries(Object.keys(saves[0].submitted).map(key => [key, saves[0].serverTask![key as keyof Task]]))).map(([label, value], field) => <div key={field}><dt className="font-semibold">{label}</dt><dd>{displayValue(value)}</dd></div>)}</dl>
    </details> : null}
    <UiButton type="button" size="lg" className="mt-3" disabled={!onCheck || checkStatus === "checking"} onClick={() => { void onCheck?.(); }}>{checkStatus === "checking" ? "Speicherstand wird geprüft …" : "Speicherstand prüfen"}</UiButton>
  </UiNotice>;
}
