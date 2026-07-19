"use client";

import { Check, ExternalLink, Save, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  safeEvidenceHost,
  type TaskOverviewDraft,
  type TaskOverviewEditPermissions,
} from "@/features/tasks/model/task-detail-presentation";
import type { Task } from "@/lib/types";
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

function ReviewEvidenceSection({
  evidenceHost,
  evidenceLink,
  evidenceRequired,
}: {
  evidenceHost: string;
  evidenceLink: string;
  evidenceRequired: string;
}) {
  return (
    <section id="task-review-evidence" tabIndex={-1} className="scroll-mt-6 border-b border-slate-100 py-5 outline-none">
      <h3 className="text-sm font-semibold text-slate-950">Nachweis</h3>
      <div className="mt-2 grid gap-2 text-[15px] leading-7 text-slate-700">
        <p>{evidenceRequired.trim() || <span className="text-slate-500">Kein erwarteter Nachweis hinterlegt.</span>}</p>
        {evidenceLink && evidenceHost ? (
          <a
            href={evidenceLink}
            target="_blank"
            rel="noreferrer"
            aria-label={`Nachweis öffnen: ${evidenceLink} (öffnet in neuem Tab)`}
            className="flex min-h-12 items-center justify-between gap-4 rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-2.5 text-blue-800 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <span>
              <span className="block text-sm font-semibold">Nachweis öffnen</span>
              <span className="mt-0.5 block text-xs text-blue-700">{evidenceHost}</span>
            </span>
            <ExternalLink size={17} aria-hidden="true" />
          </a>
        ) : evidenceLink ? (
          <p>{evidenceLink}</p>
        ) : <p className="text-slate-500">Noch kein Nachweis-Link hinterlegt.</p>}
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
  const evidenceHost = safeEvidenceHost(draft.evidenceLink);
  const evidenceValue = draft.evidenceLink.trim();
  const baselineEvidenceValue = baseline.evidenceLink.replaceAll("\r\n", "\n").trimEnd();
  const normalizedEvidenceValue = draft.evidenceLink.replaceAll("\r\n", "\n").trimEnd();
  const evidenceIsLegacyText = Boolean(evidenceValue && !evidenceHost);
  const evidenceInvalid = evidenceIsLegacyText && normalizedEvidenceValue !== baselineEvidenceValue;
  const hasReadContent = overviewFields.some(({ key }) => draft[key].trim()) || Boolean(draft.evidenceLink.trim()) || Boolean(riskContent);
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
      document.getElementById("task-evidence-link")?.focus();
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
            <UiField>
              Nachweis-Link
              <UiTextInput
                id="task-evidence-link"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                data-task-overview-field
                value={draft.evidenceLink}
                disabled={saving}
                aria-invalid={evidenceInvalid}
                aria-describedby={evidenceInvalid ? "task-evidence-error" : "task-evidence-help"}
                onChange={(event) => onChange({ evidenceLink: event.target.value })}
                inputSize="lg"
                inputPadding="md"
                placeholder="https://…"
                className="h-11"
              />
              {evidenceInvalid ? (
                <span id="task-evidence-error" className="font-normal text-red-700">Bitte eine vollständige http- oder https-URL eingeben.</span>
              ) : (
                <span id="task-evidence-help" className="font-normal text-slate-500">
                  {evidenceHost
                    ? `Vorschau: ${evidenceHost}`
                    : evidenceIsLegacyText
                      ? "Bestehender Hinweis; beim nächsten Ändern durch eine vollständige URL ersetzen."
                      : "Link zu Drive, GitHub oder einem anderen Nachweis."}
                </span>
              )}
            </UiField>
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
              evidenceHost={evidenceHost}
              evidenceLink={evidenceValue}
              evidenceRequired={draft.evidenceRequired}
            />
          ) : (
            <ReadSection label="Erforderlicher Nachweis" value={draft.evidenceRequired} anchorId="task-review-evidence" />
          )}
          {!flatReadOnly && evidenceValue && evidenceHost ? (
            <section className="border-b border-slate-100 py-5">
              <h3 className="text-sm font-semibold text-slate-950">Nachweis</h3>
              <a
                href={draft.evidenceLink}
                target="_blank"
                rel="noreferrer"
                aria-label={`Nachweis öffnen: ${draft.evidenceLink} (öffnet in neuem Tab)`}
                className="mt-2 flex min-h-14 items-center justify-between gap-4 rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-3 text-blue-800 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <span>
                  <span className="block text-sm font-semibold">Nachweis öffnen</span>
                  <span className="mt-0.5 block text-xs text-blue-700">{evidenceHost}</span>
                </span>
                <ExternalLink size={17} aria-hidden="true" />
              </a>
            </section>
          ) : !flatReadOnly && evidenceValue ? <ReadSection label="Nachweis" value={draft.evidenceLink} /> : null}
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
