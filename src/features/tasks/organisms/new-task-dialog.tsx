"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { InitiativeRaciList } from "@/features/projects/molecules/initiative-raci-list";
import { taskCreationTitleError, withSubIssueParentHierarchy } from "@/features/tasks/model/task-creation-draft";
import {
  initiativeOptions,
  milestoneOptions,
  parentDeliverableOptions,
  priorityOptions,
  relatedTaskOptions,
  taskRelationTypeOptions,
  taskStatusOptions,
} from "@/features/tasks/model/task-form-options";
import { allowedGitHubRepositories, defaultGitHubRepository } from "@/lib/github-repositories";
import { taskAssigneeOptions } from "@/lib/display";
import type { PlanningData, TaskRelationType } from "@/lib/types";
import { UiDateField, UiSelectField } from "@/shared/atoms/form-controls";
import { UiButton, UiField, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

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

export type NewTaskCreateCallbacks = {
  onError?: (message: string) => void;
};

type DraftSetter = Dispatch<SetStateAction<NewTaskDraft>>;
type TaskDialogData = Pick<PlanningData, "milestones" | "packages" | "profiles" | "sprints" | "tasks">;

function SectionHeading({ children, accent = false }: { children: string; accent?: boolean }) {
  return (
    <h3 className={`border-b border-slate-200 pb-2 font-semibold ${accent ? "text-xs uppercase tracking-wide text-blue-700" : "text-sm text-slate-950"}`}>
      {children}
    </h3>
  );
}

function RequiredLabel({ children }: { children: string }) {
  return (
    <span>
      {children} <span aria-hidden="true" className="text-blue-700">*</span>
    </span>
  );
}

function TaskBriefFields({ draft, setDraft, compact = false }: { draft: NewTaskDraft; setDraft: DraftSetter; compact?: boolean }) {
  const textAreaHeight = compact ? "sm" : "md";

  return (
    <div className="grid gap-4">
      <UiField>
        Problem
        <UiTextArea
          value={draft.problemStatement}
          onChange={(event) => setDraft((current) => ({ ...current, problemStatement: event.target.value }))}
          minHeight={textAreaHeight}
          inputPadding="md"
          leading="relaxed"
          placeholder="Welches Problem löst diese Aufgabe und warum ist sie wichtig?"
        />
      </UiField>
      <UiField>
        Zielbild
        <UiTextArea
          value={draft.intendedOutcome}
          onChange={(event) => setDraft((current) => ({ ...current, intendedOutcome: event.target.value }))}
          minHeight={textAreaHeight}
          inputPadding="md"
          leading="relaxed"
          placeholder="Welcher fertige Zustand soll am Ende erreicht sein?"
        />
      </UiField>
      <UiField>
        Umfang &amp; Grenzen
        <UiTextArea
          value={draft.scopeConstraints}
          onChange={(event) => setDraft((current) => ({ ...current, scopeConstraints: event.target.value }))}
          minHeight={textAreaHeight}
          inputPadding="md"
          leading="relaxed"
          placeholder="Was gehört dazu, was ausdrücklich nicht, und welche Rahmenbedingungen gelten?"
        />
      </UiField>
      <UiField>
        Abnahmekriterien
        <UiTextArea
          value={draft.acceptanceCriteria}
          onChange={(event) => setDraft((current) => ({ ...current, acceptanceCriteria: event.target.value }))}
          minHeight={compact ? "md" : "lg"}
          inputPadding="md"
          leading="relaxed"
          placeholder="Ein Kriterium pro Zeile. Nur messbare Punkte, die zuständige Personen beeinflussen können."
        />
      </UiField>
      <UiField>
        Nachweis
        <UiTextArea
          value={draft.evidenceRequired}
          onChange={(event) => setDraft((current) => ({ ...current, evidenceRequired: event.target.value }))}
          minHeight={textAreaHeight}
          inputPadding="md"
          leading="relaxed"
          placeholder="Welcher Nachweis muss am Ende verlinkt oder kommentiert sein?"
        />
      </UiField>
      <UiField>
        Qualitätsstandard
        <UiTextArea
          value={draft.definitionOfDone}
          onChange={(event) => setDraft((current) => ({ ...current, definitionOfDone: event.target.value }))}
          minHeight={textAreaHeight}
          inputPadding="md"
          leading="relaxed"
          placeholder="Welche Qualität muss vor Abschluss erreicht sein?"
        />
      </UiField>
    </div>
  );
}

function ResponsibilityFields({ accent = false, draft, data, setDraft }: { accent?: boolean; draft: NewTaskDraft; data: TaskDialogData; setDraft: DraftSetter }) {
  return (
    <section className="grid gap-3">
      <SectionHeading accent={accent}>Verantwortung</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        <UiSelectField
          label="Zuständig"
          value={draft.assignee}
          onChange={(value) => setDraft((current) => ({ ...current, assignee: value }))}
          options={taskAssigneeOptions(draft.taskType, data.profiles)}
        />
        <UiSelectField
          label="Priorität"
          value={draft.priority}
          onChange={(value) => setDraft((current) => ({ ...current, priority: value }))}
          options={priorityOptions}
        />
      </div>
    </section>
  );
}

function PlanningFields({ accent = false, draft, setDraft }: { accent?: boolean; draft: NewTaskDraft; setDraft: DraftSetter }) {
  return (
    <section className="grid gap-3">
      <SectionHeading accent={accent}>Planung</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        <UiSelectField
          label="Status"
          value={draft.status}
          onChange={(value) => setDraft((current) => ({ ...current, status: value }))}
          options={taskStatusOptions}
        />
        <UiField>
          Aufwand
          <div className="relative">
            <UiTextInput
              type="number"
              min={0}
              max={200}
              value={draft.hours}
              onChange={(event) => setDraft((current) => ({ ...current, hours: Number(event.target.value) }))}
              className="w-full pr-8"
              textTone="muted"
            />
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs font-normal text-slate-400">h</span>
          </div>
        </UiField>
      </div>
      <UiField>
        Bereich
        <UiTextInput
          value={draft.workstream}
          onChange={(event) => setDraft((current) => ({ ...current, workstream: event.target.value }))}
          inputPadding="md"
          textTone="muted"
          placeholder="Bereich (optional)"
        />
      </UiField>
      <div className="grid gap-3 sm:grid-cols-2">
        <UiDateField label="Start" value={draft.startDate} onChange={(value) => setDraft((current) => ({ ...current, startDate: value }))} />
        <UiDateField label="Ende" value={draft.endDate} onChange={(value) => setDraft((current) => ({ ...current, endDate: value }))} />
      </div>
      <UiDateField label="Zieltermin" value={draft.deadline} onChange={(value) => setDraft((current) => ({ ...current, deadline: value }))} />
    </section>
  );
}

function RelationshipFields({ accent = false, draft, data, setDraft }: { accent?: boolean; draft: NewTaskDraft; data: TaskDialogData; setDraft: DraftSetter }) {
  return (
    <section className="grid gap-3">
      <SectionHeading accent={accent}>Erste Abhängigkeit</SectionHeading>
      <p className="text-xs leading-5 text-slate-500">Optional, wenn diese Aufgabe von einer anderen Aufgabe abhängt, sie blockiert oder nur verknüpft ist.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <UiSelectField
          label="Beziehungstyp"
          value={draft.relationType}
          onChange={(value) => setDraft((current) => ({ ...current, relationType: value as TaskRelationType }))}
          options={taskRelationTypeOptions}
        />
        <UiSelectField
          label="Aufgabe"
          value={draft.relatedTaskId}
          onChange={(value) => setDraft((current) => ({ ...current, relatedTaskId: value }))}
          options={relatedTaskOptions(data.tasks)}
        />
      </div>
      <UiField>
        Hinweis
        <UiTextInput
          value={draft.relationNote}
          onChange={(event) => setDraft((current) => ({ ...current, relationNote: event.target.value }))}
          inputPadding="md"
          textTone="muted"
          placeholder="Optionaler Hinweis zur Abhängigkeit"
        />
      </UiField>
    </section>
  );
}

function DeliverableForm({
  canApproveNow,
  data,
  draft,
  onTitleBlur,
  setDraft,
  titleError,
  titleValidationId,
}: {
  canApproveNow: boolean;
  data: TaskDialogData;
  draft: NewTaskDraft;
  onTitleBlur: () => void;
  setDraft: DraftSetter;
  titleError: string;
  titleValidationId: string;
}) {
  const selectedInitiative = data.packages.find((pack) => pack.id === draft.packageId);
  const initiativeApproved = selectedInitiative?.approvalStatus === "approved";
  const githubHelpId = useId();

  const selectInitiative = (packageId: string) => {
    const nextInitiative = data.packages.find((pack) => pack.id === packageId);
    setDraft((current) => ({
      ...current,
      packageId,
      approveNow: nextInitiative?.approvalStatus === "approved" ? current.approveNow : false,
      createGitHubIssue: nextInitiative?.approvalStatus === "approved" ? current.createGitHubIssue : false,
    }));
  };

  return (
    <div className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
      <div className="grid content-start gap-5 p-5 sm:p-6 lg:border-r lg:border-slate-200">
        <p className="text-xs font-medium text-slate-500"><span aria-hidden="true" className="text-blue-700">*</span> Pflichtfeld</p>
        <UiField>
          <RequiredLabel>Titel</RequiredLabel>
          <UiTextInput
            data-autofocus
            data-task-title
            required
            minLength={3}
            value={draft.title}
            aria-describedby={titleError ? titleValidationId : undefined}
            aria-errormessage={titleError ? titleValidationId : undefined}
            aria-invalid={titleError ? true : undefined}
            onBlur={onTitleBlur}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            inputSize="lg"
            inputPadding="md"
            className={titleError ? "border-red-300 focus:border-red-500 focus:ring-red-100" : undefined}
            placeholder="Konkretes Ergebnis oder Vorschlag"
          />
          {titleError ? <span id={titleValidationId} aria-live="polite" className="text-red-700">{titleError}</span> : null}
        </UiField>

        <section className="grid gap-4">
          <div>
            <SectionHeading>Aufgabenbrief</SectionHeading>
            <p className="mt-2 text-xs leading-5 text-slate-500">Ergebnis und Abnahme beschreiben, ohne die Umsetzung unnötig vorzugeben.</p>
          </div>
          <TaskBriefFields draft={draft} setDraft={setDraft} />
        </section>

        <UiField>
          Zusätzlicher Kontext <span className="font-normal text-slate-400">(optional)</span>
          <UiTextArea
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            minHeight="md"
            inputPadding="md"
            leading="relaxed"
            placeholder="Relevante Hinweise, Hintergründe oder Absprachen"
          />
        </UiField>
      </div>

      <div className="grid content-start gap-5 bg-slate-50/40 p-5 sm:p-6">
        <section className="grid gap-3">
          <SectionHeading>Struktur</SectionHeading>
          <UiSelectField
            label={<RequiredLabel>Initiative</RequiredLabel>}
            value={draft.packageId}
            onChange={selectInitiative}
            options={initiativeOptions(data.packages)}
            aria-label="Initiative, Pflichtfeld"
            aria-required
          />
          <UiSelectField
            label="Epic / Meilenstein"
            value={draft.milestoneId}
            onChange={(value) => setDraft((current) => ({ ...current, milestoneId: value }))}
            options={milestoneOptions(data.milestones, "Ohne Epic")}
          />
          {selectedInitiative ? (
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Initiative-RACI</div>
              <InitiativeRaciList initiative={selectedInitiative} profiles={data.profiles} className="mt-2 grid gap-1 text-xs text-slate-600" />
            </div>
          ) : null}
          <div className="rounded-md border-b border-slate-200 px-2 py-2 text-xs text-slate-500">
            <span className="block font-semibold text-slate-600">Sprint</span>
            <span className="mt-1 block">Nach Freigabe zuweisen</span>
          </div>
        </section>

        <ResponsibilityFields draft={draft} data={data} setDraft={setDraft} />
        <PlanningFields draft={draft} setDraft={setDraft} />
        <RelationshipFields draft={draft} data={data} setDraft={setDraft} />

        <section className="grid gap-3">
          <SectionHeading>Freigabe &amp; GitHub</SectionHeading>
          <label className="flex min-h-11 items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={draft.createGitHubIssue}
              disabled={!draft.approveNow}
              aria-describedby={githubHelpId}
              onChange={(event) => setDraft((current) => ({ ...current, createGitHubIssue: event.target.checked }))}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>Zusätzlich extern anlegen</span>
          </label>
          <p id={githubHelpId} className="text-xs leading-5 text-slate-500">
            {draft.approveNow ? `GitHub Issue wird in ${defaultGitHubRepository} angelegt.` : "Verfügbar, sobald Erstellen und freigeben ausgewählt ist."}
          </p>
          {canApproveNow && !initiativeApproved ? <p className="text-xs font-semibold text-amber-700">Initiative zuerst freigeben</p> : null}
        </section>
      </div>
    </div>
  );
}

function SubIssueForm({
  data,
  draft,
  onTitleBlur,
  setDraft,
  titleError,
  titleValidationId,
}: {
  data: TaskDialogData;
  draft: NewTaskDraft;
  onTitleBlur: () => void;
  setDraft: DraftSetter;
  titleError: string;
  titleValidationId: string;
}) {
  const parentTask = data.tasks.find((task) => task.id === draft.parentTaskId && task.taskType === "deliverable");
  const inheritedInitiative = data.packages.find((pack) => pack.id === parentTask?.packageId);
  const inheritedMilestone = data.milestones.find((milestone) => milestone.id === parentTask?.milestoneId);

  return (
    <div className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,3fr)_minmax(19rem,1.65fr)]">
      <div className="grid content-start gap-5 p-5 sm:p-6 lg:border-r lg:border-slate-200">
        <p className="text-xs font-medium text-slate-500"><span aria-hidden="true" className="text-blue-700">*</span> Pflichtfeld</p>
        <UiSelectField
          label={<RequiredLabel>Übergeordnetes Deliverable</RequiredLabel>}
          value={draft.parentTaskId}
          onChange={(value) => setDraft((current) => withSubIssueParentHierarchy(current, data.tasks, value))}
          options={[{ value: "", label: "Deliverable auswählen" }, ...parentDeliverableOptions(data.tasks, data.packages)]}
          aria-label="Übergeordnetes Deliverable, Pflichtfeld"
          aria-required
          data-autofocus
          selectClassName="h-10 text-sm"
        />

        <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <div className="text-[11px] font-semibold text-slate-500">Initiative</div>
              <div className="mt-1 text-xs font-semibold text-slate-800">{inheritedInitiative?.title || "Wird übernommen"}</div>
            </div>
            <div className="border-slate-200 sm:border-l sm:pl-3">
              <div className="text-[11px] font-semibold text-slate-500">Epic / Meilenstein</div>
              <div className="mt-1 text-xs font-semibold text-slate-800">{inheritedMilestone?.title || (parentTask ? "Ohne Epic" : "Wird übernommen")}</div>
            </div>
            <div className="border-slate-200 sm:border-l sm:pl-3">
              <div className="text-[11px] font-semibold text-slate-500">RACI-Kontext</div>
              <div className="mt-1 text-xs font-semibold text-slate-800">{inheritedInitiative ? "Vom Deliverable übernommen" : "Wird übernommen"}</div>
            </div>
          </div>
          {inheritedInitiative ? <InitiativeRaciList initiative={inheritedInitiative} profiles={data.profiles} className="mt-3 grid gap-1 border-t border-slate-200 pt-3 text-xs text-slate-600 sm:grid-cols-2" /> : null}
        </div>
        <p className="text-xs leading-5 text-slate-500">Sub-Issues sind nicht score-relevant und übernehmen Initiative sowie RACI vom Deliverable.</p>

        <UiField>
          <RequiredLabel>Titel</RequiredLabel>
          <UiTextInput
            data-task-title
            required
            minLength={3}
            value={draft.title}
            aria-describedby={titleError ? titleValidationId : undefined}
            aria-errormessage={titleError ? titleValidationId : undefined}
            aria-invalid={titleError ? true : undefined}
            onBlur={onTitleBlur}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            inputSize="lg"
            inputPadding="md"
            className={titleError ? "border-red-300 focus:border-red-500 focus:ring-red-100" : undefined}
            placeholder="Konkreter Arbeitsschritt"
          />
          {titleError ? <span id={titleValidationId} aria-live="polite" className="text-red-700">{titleError}</span> : null}
        </UiField>

        <UiField>
          Beschreibung / zusätzlicher Kontext
          <UiTextArea
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            minHeight="lg"
            inputPadding="md"
            leading="relaxed"
            placeholder="Relevante Hinweise, Hintergründe oder Absprachen"
          />
        </UiField>

        <section className="grid gap-4">
          <div>
            <SectionHeading accent>Aufgabenbrief</SectionHeading>
            <p className="mt-2 text-xs leading-5 text-slate-500">Nur die für diesen Arbeitsschritt relevanten Ergebnis- und Abnahmeangaben ergänzen.</p>
          </div>
          <TaskBriefFields compact draft={draft} setDraft={setDraft} />
        </section>
      </div>

      <div className="grid content-start gap-5 bg-slate-50/40 p-5 sm:p-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4"><ResponsibilityFields accent draft={draft} data={data} setDraft={setDraft} /></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4"><PlanningFields accent draft={draft} setDraft={setDraft} /></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <section className="grid gap-3">
            <SectionHeading accent>GitHub-Ziel</SectionHeading>
            <UiSelectField
              label="Repository"
              value={draft.githubRepo}
              onChange={(value) => setDraft((current) => ({ ...current, githubRepo: value }))}
              options={[...allowedGitHubRepositories].map((repository) => ({ value: repository, label: repository }))}
            />
          </section>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4"><RelationshipFields accent draft={draft} data={data} setDraft={setDraft} /></div>
      </div>
    </div>
  );
}

export function NewTaskDialog({
  defaults,
  data,
  pending,
  onClose,
  onCreate,
  canApproveNow = false,
}: {
  defaults: Partial<NewTaskDraft>;
  data: TaskDialogData;
  pending: boolean;
  onClose: () => void;
  onCreate: (draft: NewTaskDraft, callbacks?: NewTaskCreateCallbacks) => void;
  canApproveNow?: boolean;
}) {
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose, closeDisabled: pending });
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const titleValidationId = useId();
  const initialTaskType = defaults.taskType || "deliverable";
  const [submitError, setSubmitError] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [draft, setDraft] = useState<NewTaskDraft>(() => {
    const activeSprint = data.sprints.find((sprint) => sprint.status === "active") || data.sprints[0];
    const fallbackAssignee = data.profiles[0]?.id || "volkan";
    const defaultMilestoneId = defaults.milestoneId || data.milestones.find((milestone) => milestone.status === "active")?.id || data.milestones[0]?.id || "";
    const initiativesForDefaultMilestone = data.packages.filter((pack) => !defaultMilestoneId || !pack.milestoneId || pack.milestoneId === defaultMilestoneId);
    const initialPackageId = defaults.packageId || initiativesForDefaultMilestone[0]?.id || data.packages[0]?.id || "";
    const initialInitiativeApproved = data.packages.find((pack) => pack.id === initialPackageId)?.approvalStatus === "approved";
    const initialDraft: NewTaskDraft = {
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
      packageId: initialPackageId,
      sprintId: defaults.sprintId || "",
      assignee: defaults.assignee || fallbackAssignee,
      priority: defaults.priority || "P2",
      status: defaults.status || "Offen",
      workstream: defaults.workstream || "",
      startDate: defaults.startDate || activeSprint?.startDate || "",
      endDate: defaults.endDate || activeSprint?.endDate || "",
      deadline: defaults.deadline || "",
      hours: defaults.hours || 2,
      definitionOfDone: defaults.definitionOfDone || "",
      createGitHubIssue: initialTaskType === "deliverable" && canApproveNow && initialInitiativeApproved && Boolean(defaults.approveNow) && Boolean(defaults.createGitHubIssue),
      githubRepo: defaults.githubRepo || defaultGitHubRepository,
      approveNow: initialTaskType === "deliverable" && canApproveNow && initialInitiativeApproved && Boolean(defaults.approveNow),
      relationType: defaults.relationType || "blocked_by",
      relatedTaskId: defaults.relatedTaskId || "",
      relationNote: defaults.relationNote || "",
    };

    return initialTaskType === "sub_issue"
      ? withSubIssueParentHierarchy(initialDraft, data.tasks, initialDraft.parentTaskId)
      : initialDraft;
  });

  const selectedInitiative = data.packages.find((pack) => pack.id === draft.packageId);
  const deliverableNeedsStructure = draft.taskType === "deliverable" && !draft.packageId;
  const subIssueNeedsParent = draft.taskType === "sub_issue" && !draft.parentTaskId;
  const invalidTitle = draft.title.trim().length < 3;
  const invalidDateRange = Boolean(draft.startDate && draft.endDate && draft.startDate > draft.endDate);
  const canCreate = !invalidTitle && !deliverableNeedsStructure && !subIssueNeedsParent && !invalidDateRange;
  const titleError = taskCreationTitleError(draft.title, titleTouched || submitAttempted);
  const validationReason = submitAttempted && !invalidTitle
    ? deliverableNeedsStructure
      ? "Initiative auswählen."
      : subIssueNeedsParent
        ? "Übergeordnetes Deliverable auswählen."
        : invalidDateRange
          ? "Das Startdatum darf nicht nach dem Enddatum liegen."
          : ""
    : "";
  const canApproveSelectedInitiative = canApproveNow && selectedInitiative?.approvalStatus === "approved";
  const title = draft.taskType === "sub_issue" ? "Neues Sub-Issue" : "Neues Deliverable";
  const description = draft.taskType === "sub_issue"
    ? "Konkreten Arbeitsschritt unter einem Deliverable anlegen."
    : "Ergebnis, Abnahme und Verantwortlichkeit festlegen.";

  useEffect(() => {
    if (!submitError) return;
    errorSummaryRef.current?.focus({ preventScroll: true });
  }, [submitError]);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/35"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <form
        className="grid h-dvh max-h-dvh w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-white shadow-2xl md:max-w-[64rem] md:border-l md:border-slate-200"
        aria-busy={pending}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitAttempted(true);
          if (!canCreate || pending) {
            if (invalidTitle) {
              requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLInputElement>("[data-task-title]")?.focus());
            }
            return;
          }
          setSubmitError("");
          onCreate(draft, { onError: setSubmitError });
        }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-blue-700">
              Item erstellen <span aria-hidden="true" className="px-1 text-slate-300">·</span> {draft.taskType === "sub_issue" ? "Sub-Issue" : "Deliverable"}
            </div>
            <h2 id={titleId} className="mt-1 text-xl font-semibold text-slate-950">{title}</h2>
            <p id={descriptionId} className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <UiButton type="button" onClick={onClose} disabled={pending} size="lg" className="h-11 w-11 px-0 text-slate-500" aria-label="Dialog schließen">
            <X size={18} aria-hidden="true" />
          </UiButton>
        </header>

        <div className="min-h-0 overflow-y-auto overscroll-contain" data-task-creation-scroll-body>
          {submitError ? (
            <div
              ref={errorSummaryRef}
              tabIndex={-1}
              role="alert"
              className="m-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 outline-none focus:ring-2 focus:ring-red-200 sm:mx-6"
            >
              {submitError}
            </div>
          ) : null}
          {draft.taskType === "sub_issue"
            ? (
                <SubIssueForm
                  data={data}
                  draft={draft}
                  onTitleBlur={() => setTitleTouched(true)}
                  setDraft={setDraft}
                  titleError={titleError}
                  titleValidationId={titleValidationId}
                />
              )
            : (
                <DeliverableForm
                  canApproveNow={canApproveNow}
                  data={data}
                  draft={draft}
                  onTitleBlur={() => setTitleTouched(true)}
                  setDraft={setDraft}
                  titleError={titleError}
                  titleValidationId={titleValidationId}
                />
              )}
        </div>

        <footer className="flex flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-h-5">
            {draft.taskType === "deliverable" && canApproveNow ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={draft.approveNow}
                    disabled={!canApproveSelectedInitiative || pending}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      approveNow: event.target.checked,
                      createGitHubIssue: event.target.checked ? current.createGitHubIssue : false,
                    }))}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Erstellen und freigeben
                </label>
                {!canApproveSelectedInitiative ? <span className="text-xs font-medium text-amber-700">Initiative zuerst freigeben</span> : null}
              </div>
            ) : null}
            {validationReason ? <p aria-live="polite" className="text-xs font-semibold text-amber-700">{validationReason}</p> : null}
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
            <UiButton type="button" onClick={onClose} disabled={pending} size="lg">Abbrechen</UiButton>
            <UiButton type="submit" disabled={pending || !canCreate} variant="primary" size="lg">
              {pending
                ? "Wird erstellt..."
                : draft.taskType === "sub_issue"
                  ? "Sub-Issue erstellen"
                  : draft.approveNow
                    ? "Erstellen und freigeben"
                    : "Deliverable vorschlagen"}
            </UiButton>
          </div>
        </footer>
      </form>
    </div>
  );
}
