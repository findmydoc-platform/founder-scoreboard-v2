"use client";

import { useState } from "react";
import { InitiativeRaciList } from "@/features/projects/molecules/initiative-raci-list";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiDateField, UiSelectField } from "@/shared/atoms/form-controls";
import { UiButton, UiField, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";
import { taskAssigneeOptions } from "@/lib/display";
import {
  initiativeOptions,
  milestoneOptions,
  priorityOptions,
  relatedTaskOptions,
  taskRelationTypeOptions,
  taskStatusOptions,
  taskTypeOptions,
} from "@/features/tasks/model/task-form-options";
import type { PlanningData, TaskRelationType } from "@/lib/types";
import { allowedGitHubRepositories, defaultGitHubRepository } from "@/lib/github-repositories";

export type NewTaskDraft = {
  creationRequestId: string;
  title: string;
  description: string;
  problemStatement: string;
  intendedOutcome: string;
  scopeConstraints: string;
  acceptanceCriteria: string;
  evidenceRequired: string;
  taskType: "deliverable" | "sub_issue";
  parentTaskId: string;
  milestoneId: string;
  packageId: string;
  sprintId: string;
  assignee: string;
  priority: string;
  status: string;
  workstream: string;
  startDate: string;
  endDate: string;
  deadline: string;
  hours: number;
  definitionOfDone: string;
  createGitHubIssue: boolean;
  githubRepo: string;
  approveNow: boolean;
  relationType: TaskRelationType;
  relatedTaskId: string;
  relationNote: string;
};

export function NewTaskDialog({
  defaults,
  data,
  pending,
  onClose,
  onCreate,
  canApproveNow = false,
}: {
  defaults: Partial<NewTaskDraft>;
  data: Pick<PlanningData, "milestones" | "packages" | "profiles" | "sprints" | "tasks">;
  pending: boolean;
  onClose: () => void;
  onCreate: (draft: NewTaskDraft) => void;
  canApproveNow?: boolean;
}) {
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose, closeDisabled: pending });
  const activeSprint = data.sprints.find((sprint) => sprint.status === "active") || data.sprints[0];
  const initialTaskType = defaults.taskType || "deliverable";
  const fallbackAssignee = data.profiles[0]?.id || "volkan";
  const defaultAssignee = defaults.assignee || fallbackAssignee;
  const defaultMilestoneId = defaults.milestoneId || data.milestones.find((milestone) => milestone.status === "active")?.id || data.milestones[0]?.id || "";
  const initiativesForDefaultMilestone = data.packages.filter((pack) => !defaultMilestoneId || !pack.milestoneId || pack.milestoneId === defaultMilestoneId);
  const [draft, setDraft] = useState<NewTaskDraft>({
    creationRequestId: defaults.creationRequestId || globalThis.crypto.randomUUID(),
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
    assignee: defaultAssignee,
    priority: defaults.priority || "P2",
    status: defaults.status || "Offen",
    workstream: defaults.workstream || "",
    startDate: defaults.startDate || activeSprint?.startDate || "",
    endDate: defaults.endDate || activeSprint?.endDate || "",
    deadline: defaults.deadline || "",
    hours: defaults.hours || 2,
    definitionOfDone: defaults.definitionOfDone || "",
    createGitHubIssue: Boolean(defaults.createGitHubIssue),
    githubRepo: defaults.githubRepo || defaultGitHubRepository,
    approveNow: Boolean(defaults.approveNow),
    relationType: defaults.relationType || "blocked_by",
    relatedTaskId: defaults.relatedTaskId || "",
    relationNote: defaults.relationNote || "",
  });
  const parentTask = data.tasks.find((task) => task.id === draft.parentTaskId);
  const visibleInitiatives = data.packages.filter((pack) => !draft.milestoneId || !pack.milestoneId || pack.milestoneId === draft.milestoneId);
  const selectedInitiative = data.packages.find((pack) => pack.id === draft.packageId);
  const deliverableNeedsStructure = draft.taskType === "deliverable" && !draft.packageId;
  const invalidDateRange = Boolean(draft.startDate && draft.endDate && draft.startDate > draft.endDate);
  const canCreate = draft.title.trim().length >= 3 && !deliverableNeedsStructure && !invalidDateRange && (draft.taskType !== "sub_issue" || draft.parentTaskId);

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Neue Aufgabe" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 py-8">
      <form
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-2xl"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          if (canCreate) onCreate(draft);
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Neue Aufgabe</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              {draft.taskType === "sub_issue" ? "Sub-Issue" : "Deliverable vorschlagen"}
            </h2>
          </div>
          <UiButton type="button" onClick={onClose} disabled={pending} size="iconMd" className="text-slate-500" aria-label="Dialog schließen">
            ×
          </UiButton>
        </div>

        <div className="grid gap-4 p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <UiSelectField
              label="Typ"
              value={draft.taskType}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  taskType: value as NewTaskDraft["taskType"],
                  assignee: current.assignee || fallbackAssignee,
                  createGitHubIssue: value === "deliverable" ? current.createGitHubIssue : false,
                  approveNow: value === "deliverable" ? current.approveNow : false,
                }))
              }
              options={taskTypeOptions}
            />
            <UiSelectField
              label="Epic / Meilenstein"
              value={draft.milestoneId}
              onChange={(value) => {
                const milestoneId = value;
                const firstInitiative = data.packages.find((pack) => !milestoneId || !pack.milestoneId || pack.milestoneId === milestoneId);
                setDraft((current) => ({ ...current, milestoneId, packageId: firstInitiative?.id || current.packageId }));
              }}
              options={milestoneOptions(data.milestones, "Ohne Epic")}
            />
            <UiSelectField
              label="Initiative"
              value={draft.packageId}
              onChange={(value) => setDraft((current) => ({ ...current, packageId: value }))}
              options={initiativeOptions(visibleInitiatives)}
            />
            <UiSelectField
              label="Sprint"
              value=""
              disabled
              onChange={() => undefined}
              options={[{ value: "", label: "Nach Freigabe zuweisen" }]}
            />
          </div>

          {selectedInitiative && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Initiative-RACI</div>
              <InitiativeRaciList initiative={selectedInitiative} profiles={data.profiles} className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2" />
            </div>
          )}

          {draft.taskType === "sub_issue" && (
            <UiSelectField
              label="Deliverable"
              value={draft.parentTaskId}
              onChange={(value) => setDraft((current) => ({ ...current, parentTaskId: value }))}
              options={[{ value: "", label: "Deliverable auswählen" }, ...data.tasks.filter((task) => task.taskType !== "sub_issue").map((task) => ({ value: task.id, label: task.title }))]}
            >
              {parentTask && <span className="text-xs font-normal text-slate-500">Sub-Issues unter {parentTask.title} sind nicht score-relevant.</span>}
            </UiSelectField>
          )}

          <UiField>
            Titel
            <UiTextInput value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} inputSize="lg" inputPadding="md" placeholder="Konkretes Ergebnis oder Vorschlag" />
          </UiField>

          <UiField>
            Beschreibung
            <UiTextArea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} minHeight="lg" inputPadding="md" leading="relaxed" placeholder="Kontext, Ziel und relevante Hinweise" />
          </UiField>

          <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Aufgabenbrief</div>
            <p className="mt-1 text-xs leading-5 text-slate-600">Beschreibe Ziel und prüfbare Kriterien, ohne unnötig vorzugeben, wie die Aufgabe umgesetzt werden muss.</p>
          </div>

          <UiField>
            Problem
            <UiTextArea value={draft.problemStatement} onChange={(event) => setDraft((current) => ({ ...current, problemStatement: event.target.value }))} minHeight="md" inputPadding="md" leading="relaxed" placeholder="Welches Problem löst diese Aufgabe und warum ist sie wichtig?" />
          </UiField>

          <UiField>
            Zielbild
            <UiTextArea value={draft.intendedOutcome} onChange={(event) => setDraft((current) => ({ ...current, intendedOutcome: event.target.value }))} minHeight="md" inputPadding="md" leading="relaxed" placeholder="Welcher fertige Zustand soll am Ende erreicht sein?" />
          </UiField>

          <UiField>
            Umfang & Grenzen
            <UiTextArea value={draft.scopeConstraints} onChange={(event) => setDraft((current) => ({ ...current, scopeConstraints: event.target.value }))} minHeight="md" inputPadding="md" leading="relaxed" placeholder="Was gehört dazu, was ausdrücklich nicht, und welche Rahmenbedingungen gelten?" />
          </UiField>

          <UiField>
            Abnahmekriterien
            <UiTextArea value={draft.acceptanceCriteria} onChange={(event) => setDraft((current) => ({ ...current, acceptanceCriteria: event.target.value }))} minHeight="xl" inputPadding="md" leading="relaxed" placeholder="Ein Kriterium pro Zeile. Nur messbare Punkte, die zuständige Personen beeinflussen können." />
          </UiField>

          <UiField>
            Nachweis
            <UiTextArea value={draft.evidenceRequired} onChange={(event) => setDraft((current) => ({ ...current, evidenceRequired: event.target.value }))} minHeight="md" inputPadding="md" leading="relaxed" placeholder="Welcher Nachweis muss am Ende verlinkt oder kommentiert sein?" />
          </UiField>

          <div className="grid gap-3 sm:grid-cols-4">
            <UiSelectField
              label="Zuständig"
              value={draft.assignee}
              onChange={(value) => setDraft((current) => ({ ...current, assignee: value }))}
              options={taskAssigneeOptions(draft.taskType, data.profiles)}
            >
            </UiSelectField>
            <UiSelectField
              label="Priorität"
              value={draft.priority}
              onChange={(value) => setDraft((current) => ({ ...current, priority: value }))}
              options={priorityOptions}
            />
            <UiSelectField
              label="Status"
              value={draft.status}
              onChange={(value) => setDraft((current) => ({ ...current, status: value }))}
              options={taskStatusOptions}
            />
            <UiField>
              Aufwand
              <UiTextInput type="number" min={0} value={draft.hours} onChange={(event) => setDraft((current) => ({ ...current, hours: Number(event.target.value) }))} textTone="muted" />
            </UiField>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950">Pflichtangaben</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Deliverables brauchen eine Initiative und starten als vorgeschlagen. Sprint, Review und GitHub werden erst nach Freigabe aktiv.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.createGitHubIssue}
                  disabled={draft.taskType !== "deliverable" || !draft.approveNow}
                  onChange={(event) => setDraft((current) => ({ ...current, createGitHubIssue: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Zusätzlich extern anlegen
              </label>
            </div>
            {draft.taskType === "deliverable" && canApproveNow && (
              <label className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input type="checkbox" checked={draft.approveNow} onChange={(event) => setDraft((current) => ({ ...current, approveNow: event.target.checked, createGitHubIssue: event.target.checked && current.createGitHubIssue }))} className="h-4 w-4 rounded border-slate-300" />
                Erstellen und freigeben
              </label>
            )}
            {draft.taskType === "sub_issue" && (
              <UiSelectField label="GitHub-Ziel" value={draft.githubRepo} onChange={(value) => setDraft((current) => ({ ...current, githubRepo: value }))} options={[...allowedGitHubRepositories].map((repository) => ({ value: repository, label: repository }))} />
            )}
            {deliverableNeedsStructure && <div className="mt-2 text-xs font-semibold text-amber-700">Für ein Deliverable fehlt die Initiative.</div>}
            {invalidDateRange && <div className="mt-2 text-xs font-semibold text-red-700">Das Startdatum darf nicht nach dem Enddatum liegen.</div>}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <UiField>
              Bereich
              <UiTextInput value={draft.workstream} onChange={(event) => setDraft((current) => ({ ...current, workstream: event.target.value }))} textTone="muted" />
            </UiField>
            <UiDateField label="Start" value={draft.startDate} onChange={(value) => setDraft((current) => ({ ...current, startDate: value }))} />
            <UiDateField label="Ende" value={draft.endDate} onChange={(value) => setDraft((current) => ({ ...current, endDate: value }))} />
          </div>

          <UiDateField label="Zieltermin" value={draft.deadline} onChange={(value) => setDraft((current) => ({ ...current, deadline: value }))} />

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-sm font-semibold text-slate-950">Erste Abhängigkeit</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">Optional, wenn diese Aufgabe direkt von einer anderen Aufgabe abhängt oder sie blockiert.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <CustomSelect
                value={draft.relationType}
                onChange={(value) => setDraft((current) => ({ ...current, relationType: value as TaskRelationType }))}
                className="h-9 text-sm"
                options={taskRelationTypeOptions}
              />
              <CustomSelect
                value={draft.relatedTaskId}
                onChange={(value) => setDraft((current) => ({ ...current, relatedTaskId: value }))}
                className="h-9 text-sm sm:col-span-2"
                options={relatedTaskOptions(data.tasks)}
              />
            </div>
            <UiTextInput
              value={draft.relationNote}
              onChange={(event) => setDraft((current) => ({ ...current, relationNote: event.target.value }))}
              className="mt-3 w-full"
              inputPadding="md"
              textTone="muted"
              placeholder="Optionaler Hinweis zur Abhängigkeit"
            />
          </div>

          <UiField>
            Qualitätsstandard
            <UiTextArea value={draft.definitionOfDone} onChange={(event) => setDraft((current) => ({ ...current, definitionOfDone: event.target.value }))} minHeight="md" inputPadding="md" leading="relaxed" placeholder="Welche Qualität muss vor Abschluss erreicht sein?" />
          </UiField>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <UiButton type="button" onClick={onClose} disabled={pending}>Abbrechen</UiButton>
          <UiButton type="submit" disabled={pending || !canCreate} variant="primary">
            {pending ? "Wird erstellt..." : draft.taskType === "deliverable" && draft.approveNow ? "Erstellen und freigeben" : "Erstellen"}
          </UiButton>
        </div>
      </form>
    </div>
  );
}
