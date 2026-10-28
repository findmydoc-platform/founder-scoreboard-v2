"use client";

import type { PlanningTaskSaveCheck, PlanningTaskSaveView } from "@/features/planning/model/planning-state";
import type { Profile, Sprint, Task, TaskRelationType } from "@/lib/types";
import { relationTypeLabel } from "@/lib/display";
import { reviewLabel } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";

const inputLabels: Partial<Record<keyof Task, string>> = {
  githubRepo: "Repository",
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
export type TaskInputLabels = {
  profiles: readonly Pick<Profile, "id" | "name">[];
  tasks: readonly Pick<Task, "id" | "title">[];
  sprints?: readonly Pick<Sprint, "id" | "name">[];
};

export function taskSubmittedValues(patch: Readonly<Partial<Task>> & { approveNow?: boolean; relationType?: string; relatedTaskId?: string; relationNote?: string }, labels?: TaskInputLabels) {
  const personName = (id?: string) => id ? labels?.profiles.find(profile => profile.id === id || profile.name === id)?.name || "Person nicht verfügbar" : "Nicht gesetzt";
  const taskTitle = (id?: string) => id ? labels?.tasks.find(task => task.id === id)?.title || "Aufgabe nicht verfügbar" : "Nicht gesetzt";
  const displayField = (key: keyof Task): unknown => {
    const value = patch[key];
    if (["assigneeId", "ownerId", "reviewOwnerProfileId"].includes(key)) return personName(value as string);
    if (key === "assignee" || key === "owner") return value || "Nicht gesetzt";
    if (key === "parentTaskId" || key === "dependsOn") return taskTitle(value as string);
    if (key === "sprintId") return value ? labels?.sprints?.find(sprint => sprint.id === value)?.name || "Sprint nicht verfügbar" : "Ohne Sprint";
    if (key === "reviewStatus" && value) return reviewLabel(value as Task["reviewStatus"]);
    if (key === "status" && value) return normalizeStatus(value as string);
    return value;
  };
  const values: [string, unknown][] = Object.entries(inputLabels).filter(([key]) => Object.hasOwn(patch, key)).map(([key, label]) => [label!, displayField(key as keyof Task)]);
  if (patch.strategy) values.push(["Strategisches Ziel", patch.strategy.goal], ["Erfolgskriterien", patch.strategy.successCriteria], ["Strategischer Umfang", patch.strategy.scopeConstraints]);
  if (patch.raciAssignments) values.push(["Beteiligung", patch.raciAssignments.map(item => `${personName(item.profileId)}: ${{accountable:"Verantwortlich",responsible:"Umsetzung",consulted:"Beratung",informed:"Information"}[item.role] || item.role}`).join("\n")]);
  if (patch.approveNow !== undefined) values.push(["Direkte Freigabe angefragt", patch.approveNow]);
  if (patch.relatedTaskId) values.push(["Verknüpfte Aufgabe", taskTitle(patch.relatedTaskId)], ["Verknüpfung", relationTypeLabel(patch.relationType as TaskRelationType)], ["Notiz", patch.relationNote]);
  return values;
}
export function displaySubmittedValue(value: unknown) {
  if (value === true) return "Ja";
  if (value === false) return "Nein";
  if (Array.isArray(value)) return value.join("\n") || "Leer";
  return value === null || value === undefined || value === "" ? "Leer" : String(value);
}

export function TaskSaveNotice({ taskTitle, saves, onCheck, labels }: {
  taskTitle: string;
  saves: readonly PlanningTaskSaveView[];
  onCheck?: () => Promise<PlanningTaskSaveCheck>;
  labels?: TaskInputLabels;
}) {
  if (!saves.some(save => save.phase === "unconfirmed")) return null;
  const checkStatus = saves[0].checkStatus;
  return <UiNotice tone="info" role="status" className="my-4 min-w-0 [overflow-wrap:anywhere]">
    <h2 className="font-semibold text-slate-950">Speicherung unklar</h2>
    <p className="mt-1">{taskTitle}: Ob deine Änderungen gespeichert wurden, ist noch unklar. Deine Eingaben bleiben erhalten. Weitere Änderungen an dieser Aufgabe warten.</p>
    {checkStatus === "checked" ? <p className="mt-2">Aufgabe geladen. Ob die Änderung vollständig gespeichert wurde, bleibt unklar.</p> : null}
    {checkStatus === "unavailable" ? <p className="mt-2">Die aktuellen Daten konnten nicht geladen werden. Das Ergebnis bleibt unklar.</p> : null}
    {checkStatus === "forbidden" ? <p className="mt-2">Kein Zugriff auf die Aufgabe. Die Angaben werden ausgeblendet. Ob die Änderung gespeichert wurde, bleibt unklar.</p> : null}
    {saves.map((save, index) => save.submitted ? <details className="mt-3" key={index}>
      <summary className="cursor-pointer py-2 font-semibold">{save.phase === "blocked" ? "Wartende Eingaben anzeigen" : "Abgesendete Eingaben anzeigen"}</summary>
      {save.phase === "blocked" ? <p>Diese Änderung wurde noch nicht gesendet.</p> : null}
      <dl className="mt-2 grid gap-3 whitespace-pre-wrap">{taskSubmittedValues(save.submitted, labels).map(([label, value], field) => <div key={field}><dt className="font-semibold">{label}</dt><dd>{displaySubmittedValue(value)}</dd></div>)}</dl>
    </details> : null)}
    {saves[0].serverTask && saves[0].submitted ? <details className="mt-3">
      <summary className="cursor-pointer py-2 font-semibold">Aktuellen Stand anzeigen</summary>
      <dl className="mt-2 grid gap-3 whitespace-pre-wrap">{taskSubmittedValues(Object.fromEntries(Object.keys(saves[0].submitted).map(key => [key, saves[0].serverTask![key as keyof Task]])), labels).map(([label, value], field) => <div key={field}><dt className="font-semibold">{label}</dt><dd>{displaySubmittedValue(value)}</dd></div>)}</dl>
    </details> : null}
    <UiButton type="button" size="lg" className="mt-3" disabled={!onCheck || checkStatus === "checking"} onClick={() => { void onCheck?.(); }}>{checkStatus === "checking" ? "Speicherung wird geprüft …" : "Speicherung prüfen"}</UiButton>
  </UiNotice>;
}
