"use client";

import { X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { ProfileMultiSelect } from "@/features/team/molecules/profile-multi-select";
import { currentApprovalDecisionReason } from "@/features/planning/model/approval-domain";
import type { Package, PlanningData } from "@/lib/types";
import { UiButton, UiField, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

export type InitiativeDraft = {
  id?: string;
  title: string;
  milestoneId: string;
  ownerId: string;
  accountableProfileId: string;
  responsibleProfileIds: string[];
  consultedProfileIds: string[];
  informedProfileIds: string[];
  priority: string;
  status: NonNullable<Package["status"]>;
  targetDate: string;
  goal: string;
  successCriteria: string;
  scopeConstraints: string;
  approveNow: boolean;
  approvalStatus?: Package["approvalStatus"];
  approvalRevision?: number;
  decisionNote?: string;
};

type InitiativeValidationErrors = {
  title: string;
  goal: string;
  milestoneId: string;
  ownerId: string;
  accountableProfileId: string;
  responsibleProfileIds: string;
};

type InitiativeValidationField = keyof InitiativeValidationErrors;

function initiativeValidationErrors(draft: InitiativeDraft): InitiativeValidationErrors {
  return {
    title: draft.title.trim().length >= 3 ? "" : "Der Titel benötigt mindestens 3 Zeichen.",
    goal: draft.goal.trim().length >= 3 ? "" : "Das Ziel benötigt mindestens 3 Zeichen.",
    milestoneId: draft.milestoneId ? "" : "Bitte ein Epic oder einen Meilenstein wählen.",
    ownerId: draft.ownerId ? "" : "Bitte einen Owner wählen.",
    accountableProfileId: draft.accountableProfileId ? "" : "Bitte eine accountable Person wählen.",
    responsibleProfileIds: draft.responsibleProfileIds.length > 0 ? "" : "Bitte mindestens eine responsible Person wählen.",
  };
}

function hasValidationErrors(errors: InitiativeValidationErrors) {
  return Object.values(errors).some(Boolean);
}

export function InitiativeDialog({
  defaults,
  data,
  pending,
  onClose,
  onSave,
  canApproveNow = false,
}: {
  defaults: Partial<InitiativeDraft>;
  data: PlanningData;
  pending: boolean;
  onClose: () => void;
  onSave: (draft: InitiativeDraft) => void | Promise<void>;
  canApproveNow?: boolean;
}) {
  const activeMilestoneId = data.milestones.find((milestone) => milestone.status === "active")?.id || data.milestones[0]?.id || "";
  const defaultOwnerId = defaults.ownerId || data.profiles.find((profile) => profile.platformRole === "founder")?.id || data.profiles[0]?.id || "";
  const [draft, setDraft] = useState<InitiativeDraft>({
    id: defaults.id,
    title: defaults.title || "",
    milestoneId: defaults.milestoneId || activeMilestoneId,
    ownerId: defaultOwnerId,
    accountableProfileId: defaults.accountableProfileId || defaultOwnerId,
    responsibleProfileIds: defaults.responsibleProfileIds?.length ? defaults.responsibleProfileIds : defaultOwnerId ? [defaultOwnerId] : [],
    consultedProfileIds: defaults.consultedProfileIds || [],
    informedProfileIds: defaults.informedProfileIds || [],
    priority: defaults.priority || "P2",
    status: defaults.status || "planned",
    targetDate: defaults.targetDate || "",
    goal: defaults.goal || "",
    successCriteria: defaults.successCriteria || "",
    scopeConstraints: defaults.scopeConstraints || "",
    approveNow: Boolean(defaults.approveNow),
    approvalStatus: defaults.approvalStatus,
    approvalRevision: defaults.approvalRevision,
    decisionNote: defaults.decisionNote,
  });
  const [touchedValidationFields, setTouchedValidationFields] = useState<Partial<Record<InitiativeValidationField, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const closeBlocked = pending || submitting;
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose, closeDisabled: closeBlocked });
  const bodyRef = useRef<HTMLDivElement>(null);
  const milestoneRef = useRef<HTMLDivElement>(null);
  const ownerRef = useRef<HTMLDivElement>(null);
  const accountableRef = useRef<HTMLDivElement>(null);
  const responsibleRef = useRef<HTMLDivElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const titleInputId = useId();
  const goalInputId = useId();
  const errorSummaryId = useId();
  const titleErrorId = useId();
  const goalErrorId = useId();
  const milestoneLabelId = useId();
  const milestoneErrorId = useId();
  const ownerLabelId = useId();
  const ownerErrorId = useId();
  const accountableLabelId = useId();
  const accountableErrorId = useId();
  const responsibleLabelId = useId();
  const responsibleErrorId = useId();
  const consultedLabelId = useId();
  const informedLabelId = useId();
  const primaryDisabledReasonId = useId();
  const errors = initiativeValidationErrors(draft);
  const canSave = !hasValidationErrors(errors);
  const showValidationError = (field: InitiativeValidationField) => submitAttempted || Boolean(touchedValidationFields[field]);
  const hasVisibleValidationErrors = (Object.keys(errors) as InitiativeValidationField[]).some(
    (field) => Boolean(errors[field]) && showValidationError(field),
  );
  const touchValidationField = (field: InitiativeValidationField) => {
    setTouchedValidationFields((current) => (current[field] ? current : { ...current, [field]: true }));
  };
  const isEdit = Boolean(draft.id);
  const decisionReason = currentApprovalDecisionReason({
    approvalStatus: draft.approvalStatus || null,
    decisionNote: draft.decisionNote,
  });

  const focusFirstInvalidField = () => {
    const target = errors.title
      ? document.getElementById(titleInputId)
      : errors.goal
        ? document.getElementById(goalInputId)
        : errors.milestoneId
          ? milestoneRef.current?.querySelector<HTMLElement>("button")
          : errors.ownerId
            ? ownerRef.current?.querySelector<HTMLElement>("button")
            : errors.accountableProfileId
              ? accountableRef.current?.querySelector<HTMLElement>("button")
              : responsibleRef.current?.querySelector<HTMLElement>("button");
    window.requestAnimationFrame(() => target?.focus());
  };

  const primaryLabel = closeBlocked
    ? isEdit
      ? "Wird gespeichert…"
      : draft.approveNow
        ? "Wird erstellt und freigegeben…"
        : "Wird erstellt…"
    : isEdit
      ? "Speichern"
      : draft.approveNow
        ? "Erstellen und freigeben"
        : "Initiative erstellen";

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={`${descriptionId}${submissionError ? ` ${errorSummaryId}` : ""}`}
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-0 md:p-4"
    >
      <form
        noValidate
        aria-busy={closeBlocked}
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-5xl flex-col overflow-hidden rounded-none border border-slate-200 bg-white shadow-2xl md:h-auto md:max-h-[calc(100dvh-4rem)] md:rounded-xl"
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
          const target = event.target as HTMLElement;
          const isEditable = target.matches("input, textarea, button, [role='option']");
          const direction = event.key === "PageDown" ? 1 : event.key === "PageUp" ? -1 : event.key === " " && !isEditable ? 1 : 0;
          if (!direction) return;
          event.preventDefault();
          bodyRef.current?.scrollBy({ top: direction * Math.max(240, bodyRef.current.clientHeight * 0.8), behavior: "smooth" });
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          setSubmissionError("");
          if (!canSave) {
            setSubmitAttempted(true);
            focusFirstInvalidField();
            return;
          }
          if (closeBlocked) return;
          setSubmitting(true);
          try {
            await onSave(draft);
          } catch (error) {
            setSubmissionError(error instanceof Error ? error.message : "Initiative konnte nicht gespeichert werden.");
            window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {isEdit ? "Initiative-Brief" : "Item erstellen · Initiative"}
            </div>
            <h2 id={titleId} className="mt-1 text-xl font-semibold text-slate-950">
              {isEdit ? "Initiative bearbeiten" : "Neue Initiative"}
            </h2>
            <p id={descriptionId} className="mt-1 text-sm leading-5 text-slate-600">
              {isEdit ? "Ziel, Einordnung und Verantwortung aktualisieren." : "Ziel, Erfolg und Verantwortung verbindlich beschreiben."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={closeBlocked}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 outline-none transition hover:bg-slate-50 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Initiative schließen"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div
          ref={bodyRef}
          className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 py-5 [scrollbar-gutter:stable] sm:px-6"
        >
          {submissionError && (
            <div
              ref={errorSummaryRef}
              id={errorSummaryId}
              role="alert"
              tabIndex={-1}
              className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 outline-none focus:ring-2 focus:ring-red-200"
            >
              {submissionError}
            </div>
          )}
          <p className="mb-5 text-xs font-medium text-slate-500">* Pflichtfeld</p>

          <div className="grid gap-7 lg:grid-cols-2 lg:gap-0">
            <section aria-labelledby={`${titleId}-outcome-group`} className="grid content-start gap-5 lg:pr-6">
              <h3 id={`${titleId}-outcome-group`} className="text-sm font-semibold text-slate-900">Ziel &amp; Wirkung</h3>

              <UiField>
                <span>Titel *</span>
                <UiTextInput
                  id={titleInputId}
                  data-autofocus
                  required
                  minLength={3}
                  value={draft.title}
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  onBlur={() => touchValidationField("title")}
                  aria-invalid={showValidationError("title") && Boolean(errors.title)}
                  aria-describedby={showValidationError("title") && errors.title ? titleErrorId : undefined}
                  className="h-11 px-3"
                  placeholder="z. B. Partnerpraxen-Erstkontaktmaterial"
                />
                {showValidationError("title") && errors.title && <span id={titleErrorId} className="font-medium text-red-600">{errors.title}</span>}
              </UiField>

              <UiField>
                <span>Ziel / Outcome *</span>
                <UiTextArea
                  id={goalInputId}
                  required
                  minLength={3}
                  value={draft.goal}
                  onChange={(event) => setDraft((current) => ({ ...current, goal: event.target.value }))}
                  onBlur={() => touchValidationField("goal")}
                  aria-invalid={showValidationError("goal") && Boolean(errors.goal)}
                  aria-describedby={showValidationError("goal") && errors.goal ? goalErrorId : undefined}
                  rows={5}
                  minHeight="2xl"
                  inputPadding="md"
                  leading="relaxed"
                />
                {showValidationError("goal") && errors.goal && <span id={goalErrorId} className="font-medium text-red-600">{errors.goal}</span>}
              </UiField>

              <UiField>
                Erfolgskriterien
                <UiTextArea
                  value={draft.successCriteria}
                  onChange={(event) => setDraft((current) => ({ ...current, successCriteria: event.target.value }))}
                  rows={4}
                  minHeight="xl"
                  inputPadding="md"
                  leading="relaxed"
                />
              </UiField>

              <UiField>
                Constraints
                <UiTextArea
                  value={draft.scopeConstraints}
                  onChange={(event) => setDraft((current) => ({ ...current, scopeConstraints: event.target.value }))}
                  rows={4}
                  minHeight="xl"
                  inputPadding="md"
                  leading="relaxed"
                />
              </UiField>
            </section>

            <section aria-labelledby={`${titleId}-context-group`} className="grid content-start gap-5 lg:border-l lg:border-slate-200 lg:pl-6">
              <h3 id={`${titleId}-context-group`} className="text-sm font-semibold text-slate-900">Einordnung &amp; Verantwortung</h3>

              <div
                ref={milestoneRef}
                onBlur={() => touchValidationField("milestoneId")}
                className="grid gap-1 text-xs font-semibold text-slate-500"
              >
                <span id={milestoneLabelId}>Epic / Meilenstein *</span>
                <CustomSelect
                  value={draft.milestoneId}
                  onChange={(value) => setDraft((current) => ({ ...current, milestoneId: value }))}
                  aria-labelledby={milestoneLabelId}
                  aria-required
                  aria-invalid={showValidationError("milestoneId") && Boolean(errors.milestoneId)}
                  aria-describedby={showValidationError("milestoneId") && errors.milestoneId ? milestoneErrorId : undefined}
                  className="h-11 text-sm"
                  options={data.milestones.map((milestone) => ({ value: milestone.id, label: milestone.title }))}
                />
                {showValidationError("milestoneId") && errors.milestoneId && <span id={milestoneErrorId} className="font-medium text-red-600">{errors.milestoneId}</span>}
              </div>

              <div
                ref={ownerRef}
                onBlur={() => touchValidationField("ownerId")}
                className="grid gap-1 text-xs font-semibold text-slate-500"
              >
                <span id={ownerLabelId}>Owner *</span>
                <CustomSelect
                  value={draft.ownerId}
                  onChange={(value) => setDraft((current) => ({
                    ...current,
                    ownerId: value,
                    accountableProfileId: current.accountableProfileId || value,
                    responsibleProfileIds: current.responsibleProfileIds.length ? current.responsibleProfileIds : value ? [value] : [],
                  }))}
                  aria-labelledby={ownerLabelId}
                  aria-required
                  aria-invalid={showValidationError("ownerId") && Boolean(errors.ownerId)}
                  aria-describedby={showValidationError("ownerId") && errors.ownerId ? ownerErrorId : undefined}
                  className="h-11 text-sm"
                  options={data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
                />
                {showValidationError("ownerId") && errors.ownerId && <span id={ownerErrorId} className="font-medium text-red-600">{errors.ownerId}</span>}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <UiField as="div">
                  Priorität
                  <CustomSelect
                    value={draft.priority}
                    onChange={(value) => setDraft((current) => ({ ...current, priority: value }))}
                    aria-label="Priorität"
                    className="h-11 text-sm"
                    options={["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }))}
                  />
                </UiField>
                <UiField as="div">
                  Status
                  <CustomSelect
                    value={draft.status}
                    onChange={(value) => setDraft((current) => ({ ...current, status: value as InitiativeDraft["status"] }))}
                    aria-label="Status"
                    className="h-11 text-sm"
                    options={[
                      { value: "planned", label: "Geplant" },
                      { value: "active", label: "Aktiv" },
                      { value: "done", label: "Erledigt" },
                      { value: "paused", label: "Pausiert" },
                    ]}
                  />
                </UiField>
              </div>

              <UiField as="div">
                Zieltermin
                <CustomDatePicker
                  value={draft.targetDate}
                  onChange={(value) => setDraft((current) => ({ ...current, targetDate: value }))}
                  aria-label="Zieltermin"
                  className="h-11 text-sm"
                />
              </UiField>

              <section className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4" aria-labelledby={`${titleId}-raci-group`}>
                <div>
                  <h4 id={`${titleId}-raci-group`} className="text-xs font-semibold uppercase tracking-wide text-blue-700">RACI / Verantwortung</h4>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Deliverables übernehmen diesen Verantwortungskontext.</p>
                </div>

                <div
                  ref={accountableRef}
                  onBlur={() => touchValidationField("accountableProfileId")}
                  className="grid gap-1 text-xs font-semibold text-slate-500"
                >
                  <span id={accountableLabelId}>Accountable *</span>
                  <CustomSelect
                    value={draft.accountableProfileId}
                    onChange={(value) => setDraft((current) => ({ ...current, accountableProfileId: value }))}
                    aria-labelledby={accountableLabelId}
                    aria-required
                    aria-invalid={showValidationError("accountableProfileId") && Boolean(errors.accountableProfileId)}
                    aria-describedby={showValidationError("accountableProfileId") && errors.accountableProfileId ? accountableErrorId : undefined}
                    className="h-11 text-sm"
                    options={data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
                  />
                  {showValidationError("accountableProfileId") && errors.accountableProfileId && <span id={accountableErrorId} className="font-medium text-red-600">{errors.accountableProfileId}</span>}
                </div>

                <div
                  ref={responsibleRef}
                  onBlur={() => touchValidationField("responsibleProfileIds")}
                  className="grid gap-1 text-xs font-semibold text-slate-500"
                >
                  <span id={responsibleLabelId}>Responsible *</span>
                  <ProfileMultiSelect
                    value={draft.responsibleProfileIds}
                    profiles={data.profiles}
                    onChange={(value) => setDraft((current) => ({ ...current, responsibleProfileIds: value }))}
                    placeholder="Responsible wählen"
                    aria-labelledby={responsibleLabelId}
                    aria-required
                    aria-invalid={showValidationError("responsibleProfileIds") && Boolean(errors.responsibleProfileIds)}
                    aria-describedby={showValidationError("responsibleProfileIds") && errors.responsibleProfileIds ? responsibleErrorId : undefined}
                  />
                  {showValidationError("responsibleProfileIds") && errors.responsibleProfileIds && <span id={responsibleErrorId} className="font-medium text-red-600">{errors.responsibleProfileIds}</span>}
                </div>

                <UiField as="div">
                  <span id={consultedLabelId}>Consulted</span>
                  <ProfileMultiSelect
                    value={draft.consultedProfileIds}
                    profiles={data.profiles}
                    onChange={(value) => setDraft((current) => ({ ...current, consultedProfileIds: value }))}
                    placeholder="Consulted wählen"
                    aria-labelledby={consultedLabelId}
                  />
                </UiField>

                <UiField as="div">
                  <span id={informedLabelId}>Informed</span>
                  <ProfileMultiSelect
                    value={draft.informedProfileIds}
                    profiles={data.profiles}
                    onChange={(value) => setDraft((current) => ({ ...current, informedProfileIds: value }))}
                    placeholder="Informed wählen"
                    aria-labelledby={informedLabelId}
                  />
                </UiField>
              </section>
            </section>
          </div>
        </div>

        <footer className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {!isEdit && canApproveNow && (
              <label className="inline-flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.approveNow}
                  onChange={(event) => setDraft((current) => ({ ...current, approveNow: event.target.checked }))}
                  disabled={closeBlocked}
                  className="h-5 w-5 rounded border-slate-300 accent-blue-600"
                />
                Erstellen und freigeben
              </label>
            )}
            {isEdit && draft.approvalStatus && (
              <span className="max-w-xl text-xs leading-5 text-slate-500">
                Freigabe: {draft.approvalStatus} · Revision {draft.approvalRevision || 1}
                {decisionReason ? ` · Begründung: ${decisionReason}` : ""}
              </span>
            )}
            <div className="flex items-center justify-end gap-2 sm:ml-auto">
              <UiButton onClick={onClose} disabled={closeBlocked} size="lg">Abbrechen</UiButton>
              <UiButton
                type="submit"
                disabled={closeBlocked || !canSave}
                aria-describedby={hasVisibleValidationErrors ? primaryDisabledReasonId : undefined}
                variant="primary"
                size="lg"
              >
                {primaryLabel}
              </UiButton>
            </div>
          </div>
          {hasVisibleValidationErrors && (
            <p id={primaryDisabledReasonId} role="status" className="mt-2 text-right text-xs font-medium text-slate-500">
              Bitte alle Pflichtfelder ausfüllen.
            </p>
          )}
        </footer>
      </form>
    </div>
  );
}
