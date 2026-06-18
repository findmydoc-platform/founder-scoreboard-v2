"use client";

import { useState } from "react";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { initiativeOptionLabel, initiativeRaciRows, taskOwnerLabel, taskOwnerOptions } from "@/lib/display";
import { taskStatuses } from "@/lib/status";
import type { PlanningData, TaskRelationType } from "@/lib/types";

export type NewTaskDraft = {
  title: string;
  description: string;
  problemStatement: string;
  intendedOutcome: string;
  scopeConstraints: string;
  acceptanceCriteria: string;
  evidenceRequired: string;
  taskType: "deliverable" | "proposal" | "sub_issue";
  parentTaskId: string;
  milestoneId: string;
  packageId: string;
  sprintId: string;
  owner: string;
  priority: string;
  status: string;
  workstream: string;
  startDate: string;
  endDate: string;
  deadline: string;
  hours: number;
  definitionOfDone: string;
  createGitHubIssue: boolean;
  relationType: TaskRelationType;
  relatedTaskId: string;
  relationNote: string;
  decisionId: number;
  decisionLinkNote: string;
};

export function NewTaskDialog({
  defaults,
  data,
  pending,
  onClose,
  onCreate,
}: {
  defaults: Partial<NewTaskDraft>;
  data: PlanningData;
  pending: boolean;
  onClose: () => void;
  onCreate: (draft: NewTaskDraft) => void;
}) {
  const activeSprint = data.sprints.find((sprint) => sprint.status === "active") || data.sprints[0];
  const initialTaskType = defaults.taskType || "deliverable";
  const fallbackOwner = data.profiles[0]?.name || "Volkan";
  const defaultOwner = defaults.owner || (initialTaskType === "proposal" ? "" : fallbackOwner);
  const defaultMilestoneId = defaults.milestoneId || data.milestones.find((milestone) => milestone.status === "active")?.id || data.milestones[0]?.id || "";
  const initiativesForDefaultMilestone = data.packages.filter((pack) => !defaultMilestoneId || !pack.milestoneId || pack.milestoneId === defaultMilestoneId);
  const [draft, setDraft] = useState<NewTaskDraft>({
    title: defaults.title || "",
    description: defaults.description || "",
    problemStatement: defaults.problemStatement || "",
    intendedOutcome: defaults.intendedOutcome || "",
    scopeConstraints: defaults.scopeConstraints || "",
    acceptanceCriteria: defaults.acceptanceCriteria || "",
    evidenceRequired: defaults.evidenceRequired || "",
    taskType: initialTaskType,
    parentTaskId: defaults.parentTaskId || "",
    milestoneId: defaultMilestoneId,
    packageId: defaults.packageId || initiativesForDefaultMilestone[0]?.id || data.packages[0]?.id || "",
    sprintId: defaults.sprintId || activeSprint?.id || "",
    owner: defaultOwner,
    priority: defaults.priority || "P2",
    status: defaults.status || "Offen",
    workstream: defaults.workstream || "",
    startDate: defaults.startDate || activeSprint?.startDate || "",
    endDate: defaults.endDate || activeSprint?.endDate || "",
    deadline: defaults.deadline || "",
    hours: defaults.hours || 2,
    definitionOfDone: defaults.definitionOfDone || "",
    createGitHubIssue: (defaults.taskType || "deliverable") === "deliverable",
    relationType: defaults.relationType || "blocked_by",
    relatedTaskId: defaults.relatedTaskId || "",
    relationNote: defaults.relationNote || "",
    decisionId: defaults.decisionId || 0,
    decisionLinkNote: defaults.decisionLinkNote || "",
  });
  const parentTask = data.tasks.find((task) => task.id === draft.parentTaskId);
  const visibleInitiatives = data.packages.filter((pack) => !draft.milestoneId || !pack.milestoneId || pack.milestoneId === draft.milestoneId);
  const selectedInitiative = data.packages.find((pack) => pack.id === draft.packageId);
  const deliverableNeedsStructure = draft.taskType === "deliverable" && (!draft.packageId || !draft.sprintId);
  const invalidDateRange = Boolean(draft.startDate && draft.endDate && draft.startDate > draft.endDate);
  const canCreate = draft.title.trim().length >= 3 && !deliverableNeedsStructure && !invalidDateRange && (draft.taskType !== "sub_issue" || draft.parentTaskId);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 py-8">
      <form
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (canCreate) onCreate(draft);
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Neue Aufgabe</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              {draft.taskType === "proposal" ? "Aufgabenvorschlag" : draft.taskType === "sub_issue" ? "Sub-Issue" : "Deliverable"}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Dialog schließen">
            ×
          </button>
        </div>

        <div className="grid gap-4 p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Typ
              <CustomSelect
                value={draft.taskType}
                onChange={(value) => setDraft((current) => ({
                  ...current,
                  taskType: value as NewTaskDraft["taskType"],
                  owner: value === "proposal" ? "" : current.owner || fallbackOwner,
                  createGitHubIssue: value === "deliverable" ? current.createGitHubIssue : false,
                }))}
                className="h-9 text-sm"
                options={[{ value: "deliverable", label: "Deliverable" }, { value: "proposal", label: "Vorschlag" }, { value: "sub_issue", label: "Sub-Issue" }]}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Epic / Meilenstein
              <CustomSelect
                value={draft.milestoneId}
                onChange={(value) => {
                  const milestoneId = value;
                  const firstInitiative = data.packages.find((pack) => !milestoneId || !pack.milestoneId || pack.milestoneId === milestoneId);
                  setDraft((current) => ({ ...current, milestoneId, packageId: firstInitiative?.id || current.packageId }));
                }}
                className="h-9 text-sm"
                options={[{ value: "", label: "Ohne Epic" }, ...data.milestones.map((milestone) => ({ value: milestone.id, label: milestone.title }))]}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Initiative
              <CustomSelect value={draft.packageId} onChange={(value) => setDraft((current) => ({ ...current, packageId: value }))} className="h-9 text-sm" options={visibleInitiatives.map((pack) => ({ value: pack.id, label: initiativeOptionLabel(pack) }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Sprint
              <CustomSelect value={draft.sprintId} disabled={draft.taskType !== "deliverable"} onChange={(value) => setDraft((current) => ({ ...current, sprintId: value }))} className="h-9 text-sm" options={data.sprints.map((sprint) => ({ value: sprint.id, label: sprint.name }))} />
            </label>
          </div>

          {selectedInitiative && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Initiative-RACI</div>
              <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                {initiativeRaciRows(selectedInitiative, data.profiles).map((row) => (
                  <div key={row.label} className="flex min-w-0 gap-2">
                    <span className="w-4 shrink-0 font-semibold text-blue-700">{row.label}</span>
                    <span className="min-w-0 truncate" title={`${row.title}: ${row.value}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {draft.taskType === "sub_issue" && (
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Deliverable
              <CustomSelect value={draft.parentTaskId} onChange={(value) => setDraft((current) => ({ ...current, parentTaskId: value }))} className="h-9 text-sm" options={[{ value: "", label: "Deliverable auswählen" }, ...data.tasks.filter((task) => task.taskType !== "sub_issue").map((task) => ({ value: task.id, label: task.title }))]} />
              {parentTask && <span className="text-xs font-normal text-slate-500">Sub-Issues unter {parentTask.title} sind nicht score-relevant.</span>}
            </label>
          )}

          {draft.decisionId > 0 && (
            <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm text-blue-950">
              <div className="font-semibold">Wird als Decision-Folgeaufgabe verknüpft</div>
              <p className="mt-1 text-xs leading-5 text-blue-800">{draft.decisionLinkNote || "Diese Aufgabe folgt aus einer Decision."}</p>
            </div>
          )}

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Titel
            <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="h-10 rounded-md border border-slate-200 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400" placeholder="Konkretes Ergebnis oder Vorschlag" />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Beschreibung
            <textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="min-h-24 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Kontext, Ziel und relevante Hinweise" />
          </label>

          <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Template v2</div>
            <p className="mt-1 text-xs leading-5 text-slate-600">Beschreibe das Ziel und die prüfbaren Kriterien, ohne unnötig vorzugeben, wie die Aufgabe umgesetzt werden muss.</p>
          </div>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Problem Statement
            <textarea value={draft.problemStatement} onChange={(event) => setDraft((current) => ({ ...current, problemStatement: event.target.value }))} className="min-h-20 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Welches Problem löst diese Aufgabe und warum ist sie wichtig?" />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Intended Outcome
            <textarea value={draft.intendedOutcome} onChange={(event) => setDraft((current) => ({ ...current, intendedOutcome: event.target.value }))} className="min-h-20 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Welcher fertige Zustand soll am Ende erreicht sein?" />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Scope & Constraints
            <textarea value={draft.scopeConstraints} onChange={(event) => setDraft((current) => ({ ...current, scopeConstraints: event.target.value }))} className="min-h-20 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Was gehört dazu, was ausdrücklich nicht, und welche Rahmenbedingungen gelten?" />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Acceptance Criteria
            <textarea value={draft.acceptanceCriteria} onChange={(event) => setDraft((current) => ({ ...current, acceptanceCriteria: event.target.value }))} className="min-h-28 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Ein Kriterium pro Zeile. Nur messbare Punkte, die der Owner beeinflussen kann." />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Evidence Required
            <textarea value={draft.evidenceRequired} onChange={(event) => setDraft((current) => ({ ...current, evidenceRequired: event.target.value }))} className="min-h-20 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Welcher Nachweis muss am Ende verlinkt oder kommentiert sein?" />
          </label>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Assignee
              <CustomSelect value={draft.owner} onChange={(value) => setDraft((current) => ({ ...current, owner: value }))} className="h-9 text-sm" options={taskOwnerOptions(draft.taskType, data.profiles)} />
              {draft.taskType === "proposal" && <span className="text-[11px] font-normal leading-4 text-slate-500">Vorschläge können bewusst ohne Assignee bleiben.</span>}
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Priorität
              <CustomSelect value={draft.priority} onChange={(value) => setDraft((current) => ({ ...current, priority: value }))} className="h-9 text-sm" options={["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Status
              <CustomSelect value={draft.status} disabled={draft.taskType === "proposal"} onChange={(value) => setDraft((current) => ({ ...current, status: value }))} className="h-9 text-sm" options={taskStatuses.map((status) => ({ value: status, label: status }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Aufwand
              <input type="number" min={0} value={draft.hours} onChange={(event) => setDraft((current) => ({ ...current, hours: Number(event.target.value) }))} className="h-9 rounded-md border border-slate-200 px-2 text-sm font-normal text-slate-800" />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950">Strukturprüfung</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Deliverables brauchen Epic, Initiative und Sprint. Sub-Issues bleiben unter einem Deliverable und sind nicht score-relevant.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.createGitHubIssue}
                  disabled={draft.taskType !== "deliverable"}
                  onChange={(event) => setDraft((current) => ({ ...current, createGitHubIssue: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Direkt als GitHub-Issue anlegen
              </label>
            </div>
            {deliverableNeedsStructure && <div className="mt-2 text-xs font-semibold text-amber-700">Für ein Deliverable fehlen noch Sprint oder Initiative.</div>}
            {invalidDateRange && <div className="mt-2 text-xs font-semibold text-red-700">Das Startdatum darf nicht nach dem Enddatum liegen.</div>}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Workstream
              <input value={draft.workstream} onChange={(event) => setDraft((current) => ({ ...current, workstream: event.target.value }))} className="h-9 rounded-md border border-slate-200 px-2 text-sm font-normal text-slate-800" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Start
              <CustomDatePicker value={draft.startDate} onChange={(value) => setDraft((current) => ({ ...current, startDate: value }))} className="h-9 text-sm" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Ende
              <CustomDatePicker value={draft.endDate} onChange={(value) => setDraft((current) => ({ ...current, endDate: value }))} className="h-9 text-sm" />
            </label>
          </div>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Zieltermin
            <CustomDatePicker value={draft.deadline} onChange={(value) => setDraft((current) => ({ ...current, deadline: value }))} className="h-9 text-sm" />
          </label>

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-sm font-semibold text-slate-950">Erste Relationship</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">Optional, wenn diese Aufgabe direkt von einer anderen Aufgabe abhängt oder sie blockiert.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <CustomSelect
                value={draft.relationType}
                onChange={(value) => setDraft((current) => ({ ...current, relationType: value as TaskRelationType }))}
                className="h-9 text-sm"
                options={[
                  { value: "blocked_by", label: "Wartet auf" },
                  { value: "blocks", label: "Blockiert" },
                  { value: "relates_to", label: "Verknüpft mit" },
                ]}
              />
              <CustomSelect
                value={draft.relatedTaskId}
                onChange={(value) => setDraft((current) => ({ ...current, relatedTaskId: value }))}
                className="h-9 text-sm sm:col-span-2"
                options={[
                  { value: "", label: "Keine Relationship" },
                  ...data.tasks.filter((task) => task.taskType !== "sub_issue").map((task) => ({ value: task.id, label: `${task.title} · ${taskOwnerLabel(task)}` })),
                ]}
              />
            </div>
            <input
              value={draft.relationNote}
              onChange={(event) => setDraft((current) => ({ ...current, relationNote: event.target.value }))}
              className="mt-3 h-9 w-full rounded-md border border-slate-200 px-3 text-sm font-normal text-slate-800 outline-none focus:border-blue-400"
              placeholder="Optionaler Hinweis zur Abhängigkeit"
            />
          </div>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Definition of Done
            <textarea value={draft.definitionOfDone} onChange={(event) => setDraft((current) => ({ ...current, definitionOfDone: event.target.value }))} className="min-h-20 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Allgemeiner Qualitätsstandard oder DoD-Snapshot für dieses Deliverable" />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">Abbrechen</button>
          <button type="submit" disabled={pending || !canCreate} className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            Erstellen
          </button>
        </div>
      </form>
    </div>
  );
}
