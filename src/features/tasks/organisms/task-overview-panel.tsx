"use client";

import { Check, ExternalLink, GitPullRequest, Globe2, Save, X } from "lucide-react";
import { SiGithub, SiNotion } from "@icons-pack/react-simple-icons";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  type TaskOverviewDraft,
  type TaskOverviewEditPermissions,
} from "@/features/tasks/model/task-detail-presentation";
import {
  evidenceLinkFields,
  evidenceLinkPresentation,
  parseEvidenceUrl,
} from "@/features/tasks/model/task-evidence-links";
import type { LinkedPullRequest, Task } from "@/lib/types";
import { formatDate } from "@/lib/display";
import { classNames, UiButton, UiEmptyState, UiField, UiNotice, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";

const overviewFields = [
  { key: "problemStatement", label: "Problem", placeholder: "Welches Problem löst diese Aufgabe und warum ist es wichtig?", permission: "canEditBrief" },
  { key: "intendedOutcome", label: "Zielbild", placeholder: "Welcher fertige Zustand soll erreicht sein?", permission: "canEditBrief" },
  { key: "scopeConstraints", label: "Umfang & Grenzen", placeholder: "Was gehört dazu, was ausdrücklich nicht?", permission: "canEditBrief" },
  { key: "acceptanceCriteria", label: "Abnahmekriterien", placeholder: "Ein prüfbares Kriterium pro Zeile.", permission: "canEditChecklist" },
  { key: "evidenceRequired", label: "Erforderlicher Nachweis", placeholder: "Welcher Nachweis wird für die Abnahme erwartet?", permission: "canEditBrief" },
  { key: "definitionOfDone", label: "Qualitätsstandard", placeholder: "Welche Qualität muss vor Abschluss erreicht sein?", permission: "canEditChecklist" },
  { key: "note", label: "Interne Notiz", placeholder: "Entscheidung, Kontext oder nächster interner Hinweis", permission: "canEditNotes" },
] as const;

function ChecklistReadValue({ value }: { value: string }) {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  return (
    <ul className="grid gap-2">
      {lines.map((line, index) => (
        <li key={`${line}-${index}`} className="flex items-start gap-2 text-[15px] leading-7 text-slate-700">
          <span className="mt-1.5 grid h-4 w-4 shrink-0 place-items-center rounded border border-slate-300 bg-white" aria-hidden="true">
            {/^\s*[-*]?\s*\[[xX]\]/.test(line) ? <Check size={11} className="text-emerald-600" /> : null}
          </span>
          <span>{line.replace(/^\s*[-*]?\s*\[[ xX]\]\s*/, "")}</span>
        </li>
      ))}
    </ul>
  );
}

function ReadSection({
  label,
  value,
  checklist = false,
  anchorId,
  emptyValue,
}: {
  label: string;
  value: string;
  checklist?: boolean;
  anchorId?: string;
  emptyValue?: string;
}) {
  const hasValue = Boolean(value.trim());
  if (!hasValue && !emptyValue) return anchorId ? <span id={anchorId} className="block scroll-mt-6" /> : null;
  return (
    <section
      id={anchorId}
      tabIndex={anchorId ? -1 : undefined}
      className="scroll-mt-6 border-b border-slate-100 py-5 outline-none last:border-b-0"
    >
      <h3 className="text-sm font-semibold text-slate-950">{label}</h3>
      {hasValue ? (
        <div className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-slate-700">
          {checklist ? <ChecklistReadValue value={value} /> : value}
        </div>
      ) : <p className="mt-2 text-[15px] leading-7 text-slate-500">{emptyValue}</p>}
    </section>
  );
}

function EvidenceProviderIcon({ provider }: { provider: ReturnType<typeof evidenceLinkPresentation>["provider"] }) {
  if (provider === "github") return <SiGithub size={18} aria-hidden="true" />;
  if (provider === "notion") return <SiNotion size={18} aria-hidden="true" />;
  return <Globe2 size={18} aria-hidden="true" />;
}

function EvidenceLinksList({ links }: { links: string[] }) {
  if (!links.length) return <p className="text-sm text-slate-500">Noch keine Links hinterlegt.</p>;
  return (
    <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {links.map((link) => {
        const presentation = evidenceLinkPresentation(link);
        const url = parseEvidenceUrl(link);
        const detail = url ? `${presentation.host}${url.pathname === "/" ? "" : url.pathname}` : link;
        return (
          <li key={link} className="border-b border-slate-100 last:border-b-0">
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              aria-label={`${presentation.label}-Nachweis öffnen: ${link} (öffnet in neuem Tab)`}
              className="group flex min-h-14 items-center gap-3 px-3.5 py-2.5 text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
                <EvidenceProviderIcon provider={presentation.provider} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">{presentation.label}</span>
                <span className="block truncate text-xs text-slate-500">{detail}</span>
              </span>
              <ExternalLink size={15} className="shrink-0 text-slate-400 transition group-hover:text-slate-600" aria-hidden="true" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

const pullRequestStatusPresentation = {
  open: { label: "Offen", iconClassName: "text-emerald-600", badgeClassName: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  merged: { label: "Gemergt", iconClassName: "text-violet-600", badgeClassName: "bg-violet-50 text-violet-700 ring-violet-600/20" },
  closed: { label: "Geschlossen", iconClassName: "text-red-600", badgeClassName: "bg-red-50 text-red-700 ring-red-600/20" },
} as const;

function LinkedPullRequestsList({ pullRequests }: { pullRequests: LinkedPullRequest[] }) {
  if (!pullRequests.length) {
    return <p className="text-sm text-slate-500">Noch keine Pull Requests mit dem GitHub Issue verknüpft.</p>;
  }
  return (
    <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {pullRequests.map((pullRequest) => {
        const status = pullRequestStatusPresentation[pullRequest.status];
        return (
          <li key={`${pullRequest.repository}#${pullRequest.number}`} className="border-b border-slate-100 last:border-b-0">
            <a
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Pull Request ${pullRequest.repository} Nummer ${pullRequest.number}: ${pullRequest.title}, Status ${status.label} (öffnet in neuem Tab)`}
              className="group flex min-h-16 items-center gap-3 px-3.5 py-2.5 text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 bg-slate-50">
                <GitPullRequest size={18} className={status.iconClassName} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">{pullRequest.title}</span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">{pullRequest.repository} #{pullRequest.number}</span>
              </span>
              <span className={classNames("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", status.badgeClassName)}>
                {status.label}
              </span>
              <ExternalLink size={15} className="shrink-0 text-slate-400 transition group-hover:text-slate-600" aria-hidden="true" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function EvidenceGroups({
  evidenceLinks,
  linkedPullRequests,
}: {
  evidenceLinks: string[];
  linkedPullRequests: LinkedPullRequest[];
}) {
  return (
    <div className="mt-3 grid gap-5">
      <div>
        <h4 className="mb-2 text-sm font-medium text-slate-600">Links</h4>
        <EvidenceLinksList links={evidenceLinks} />
      </div>
      <div>
        <h4 className="mb-2 text-sm font-medium text-slate-600">Verknüpfte Pull Requests</h4>
        <LinkedPullRequestsList pullRequests={linkedPullRequests} />
      </div>
    </div>
  );
}

function ReviewEvidenceSection({
  evidenceLinks,
  evidenceRequired,
  linkedPullRequests,
}: {
  evidenceLinks: string[];
  evidenceRequired: string;
  linkedPullRequests: LinkedPullRequest[];
}) {
  return (
    <section
      id="task-review-evidence"
      data-tour-id="task-evidence-links"
      tabIndex={-1}
      className="scroll-mt-6 border-b border-slate-100 py-5 outline-none"
    >
      <h3 className="text-sm font-semibold text-slate-950">Nachweis</h3>
      <div className="mt-2 text-[15px] leading-7 text-slate-700">
        <p>{evidenceRequired.trim() || <span className="text-slate-500">Kein erwarteter Nachweis hinterlegt.</span>}</p>
        <EvidenceGroups evidenceLinks={evidenceLinks} linkedPullRequests={linkedPullRequests} />
      </div>
    </section>
  );
}

type Props = {
  task: Task;
  baseline: TaskOverviewDraft;
  draft: TaskOverviewDraft;
  permissions: TaskOverviewEditPermissions;
  editing: boolean;
  dirty: boolean;
  saving: boolean;
  error: string;
  flat?: boolean;
  onCancel: () => void;
  onSave: () => Promise<boolean>;
  onChange: (patch: Partial<TaskOverviewDraft>) => void;
  riskContent?: ReactNode;
};

export function TaskOverviewPanel({
  task,
  baseline,
  draft,
  permissions,
  editing,
  dirty,
  saving,
  error,
  flat = false,
  onCancel,
  onSave,
  onChange,
  riskContent,
}: Props) {
  const [announcement, setAnnouncement] = useState("");
  const previousEditingRef = useRef(editing);
  const editableEvidenceFields = evidenceLinkFields(draft.evidenceLinks);
  const evidenceInvalidIndex = editableEvidenceFields.findIndex((value, index) => (
    Boolean(value.trim())
    && !parseEvidenceUrl(value)
    && value.trim() !== (baseline.evidenceLinks[index] || "").trim()
  ));
  const evidenceInvalid = evidenceInvalidIndex >= 0;
  const evidenceLinks = draft.evidenceLinks.map((value) => value.trim()).filter((value) => Boolean(parseEvidenceUrl(value)));
  const linkedPullRequests = task.linkedPullRequests || [];
  const hasReadContent = overviewFields.some(({ key }) => draft[key].trim())
    || evidenceLinks.length > 0
    || linkedPullRequests.length > 0
    || Boolean(riskContent);
  const flatReadOnly = flat && !editing;

  useEffect(() => {
    const wasEditing = previousEditingRef.current;
    previousEditingRef.current = editing;
    if (!editing && !wasEditing) return;

    const frame = window.requestAnimationFrame(() => {
      if (editing) {
        document.querySelector<HTMLElement>("[data-task-overview-field]")?.focus();
        setAnnouncement("Bearbeitungsmodus geöffnet.");
      } else {
        document.getElementById("task-detail-edit")?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (evidenceInvalid) {
      document.getElementById(`task-evidence-link-${evidenceInvalidIndex}`)?.focus();
      return;
    }
    const saved = await onSave();
    if (saved) {
      setAnnouncement("Änderungen gespeichert.");
    } else {
      window.requestAnimationFrame(() => document.getElementById("task-overview-error")?.focus());
    }
  };

  return (
    <section
      aria-label={flatReadOnly ? "Übersicht" : undefined}
      aria-labelledby={flatReadOnly ? undefined : "task-overview-heading"}
      className={classNames(
        "bg-white",
        !flatReadOnly && "overflow-hidden rounded-xl border border-slate-200 shadow-sm",
      )}
    >
      {!flatReadOnly ? (
        <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <h2 id="task-overview-heading" className="text-base font-semibold text-slate-950">Übersicht</h2>
            <p className="mt-1 text-sm text-slate-500">Ziel, Abnahme und notwendige Nachweise für die Umsetzung.</p>
          </div>
        </div>
      ) : null}

      {editing ? (
        <form onSubmit={submit} aria-busy={saving} className="grid gap-5 px-5 py-5 sm:px-6">
          {error ? (
            <UiNotice id="task-overview-error" tabIndex={-1} tone="danger" role="alert" className="outline-none focus:ring-2 focus:ring-red-400">
              {error}
            </UiNotice>
          ) : null}

          {permissions.canEditBrief ? (
            <UiField>
              Titel
              <UiTextInput
                id="task-overview-title"
                data-task-overview-field
                value={draft.title}
                disabled={saving}
                onChange={(event) => onChange({ title: event.target.value })}
                inputSize="lg"
                inputPadding="md"
                className="h-11 text-base"
              />
            </UiField>
          ) : null}

          {overviewFields.map(({ key, label, placeholder, permission }) => permissions[permission] ? (
            <UiField key={key}>
              {label}
              <UiTextArea
                data-task-overview-field
                value={draft[key]}
                disabled={saving}
                onChange={(event) => onChange({ [key]: event.target.value })}
                minHeight={key === "note" ? "md" : "lg"}
                inputPadding="md"
                leading="relaxed"
                placeholder={placeholder}
              />
            </UiField>
          ) : null)}

          {permissions.canEditEvidence ? (
            <fieldset className="grid gap-3" data-tour-id="task-evidence-links">
              <legend className="text-sm font-semibold text-slate-950">Nachweis-Links</legend>
              <p className="-mt-1 text-sm text-slate-500">
                Sobald ein Link eingetragen ist, erscheint automatisch das nächste Feld. Leere Felder werden nicht gespeichert.
              </p>
              <div className="grid gap-2.5">
                {editableEvidenceFields.map((value, index) => {
                  const invalid = evidenceInvalidIndex === index;
                  const presentation = parseEvidenceUrl(value) ? evidenceLinkPresentation(value) : null;
                  return (
                    <UiField key={`evidence-${index}`}>
                      <span className="sr-only">Nachweis-Link {index + 1}</span>
                      <div className="relative">
                        <UiTextInput
                          id={`task-evidence-link-${index}`}
                          type="text"
                          inputMode="url"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          data-task-overview-field
                          value={value}
                          disabled={saving}
                          aria-label={`Nachweis-Link ${index + 1}`}
                          aria-invalid={invalid}
                          aria-describedby={invalid ? `task-evidence-error-${index}` : undefined}
                          onChange={(event) => {
                            const nextLinks = [...editableEvidenceFields];
                            nextLinks[index] = event.target.value;
                            onChange({ evidenceLinks: evidenceLinkFields(nextLinks) });
                          }}
                          inputSize="lg"
                          inputPadding="md"
                          placeholder="https://…"
                          className="h-11 w-full min-w-0 pr-28"
                        />
                        {presentation ? (
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                            <EvidenceProviderIcon provider={presentation.provider} />
                            {presentation.label}
                          </span>
                        ) : null}
                      </div>
                      {invalid ? (
                        <span id={`task-evidence-error-${index}`} className="font-normal text-red-700">
                          Bitte eine vollständige http- oder https-URL eingeben.
                        </span>
                      ) : null}
                    </UiField>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap justify-end gap-3 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:-mx-6 sm:px-6">
            <UiButton type="button" onClick={onCancel} disabled={saving} size="lg">
              <X size={15} aria-hidden="true" />
              Abbrechen
            </UiButton>
            <UiButton type="submit" variant="primary" size="lg" disabled={!dirty || evidenceInvalid || saving}>
              <Save size={15} aria-hidden="true" />
              {saving ? "Speichert …" : "Speichern"}
            </UiButton>
          </div>
        </form>
      ) : (
        <div className={flatReadOnly ? "" : "px-5 sm:px-6"}>
          {!hasReadContent ? <UiEmptyState className="my-5">Für dieses Item ist noch keine Beschreibung hinterlegt.</UiEmptyState> : null}
          <ReadSection label="Problem" value={draft.problemStatement} />
          <ReadSection
            label="Zielbild"
            value={draft.intendedOutcome}
            anchorId="task-review-outcome"
            emptyValue={flatReadOnly ? "Kein Zielbild hinterlegt." : undefined}
          />
          <ReadSection label="Umfang & Grenzen" value={draft.scopeConstraints} />
          <ReadSection
            label="Abnahmekriterien"
            value={draft.acceptanceCriteria}
            checklist
            anchorId="task-review-acceptance"
            emptyValue={flatReadOnly ? "Keine Abnahmekriterien hinterlegt." : undefined}
          />
          {flatReadOnly ? (
            <ReviewEvidenceSection
              evidenceLinks={evidenceLinks}
              evidenceRequired={draft.evidenceRequired}
              linkedPullRequests={linkedPullRequests}
            />
          ) : (
            <ReadSection label="Erforderlicher Nachweis" value={draft.evidenceRequired} anchorId="task-review-evidence" />
          )}
          {!flatReadOnly ? (
            <section
              data-tour-id="task-evidence-links"
              className="border-b border-slate-100 py-5"
            >
              <h3 className="text-sm font-semibold text-slate-950">Nachweis</h3>
              <EvidenceGroups evidenceLinks={evidenceLinks} linkedPullRequests={linkedPullRequests} />
            </section>
          ) : null}
          {flatReadOnly ? riskContent : null}
          <ReadSection
            label="Qualitätsstandard"
            value={draft.definitionOfDone}
            checklist
            emptyValue={flatReadOnly ? "Kein Qualitätsstandard hinterlegt." : undefined}
          />
          {!flatReadOnly ? riskContent : null}
          <ReadSection label="Interne Notiz" value={draft.note} />
          {task.updatedAt ? <p className="border-t border-slate-100 py-4 text-xs text-slate-400">Zuletzt aktualisiert am {formatDate(task.updatedAt)}</p> : null}
        </div>
      )}
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </section>
  );
}
