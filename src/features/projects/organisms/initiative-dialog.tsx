"use client";

import { useState } from "react";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { ProfileMultiSelect } from "@/features/team/molecules/profile-multi-select";
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
  onSave: (draft: InitiativeDraft) => void;
  canApproveNow?: boolean;
}) {
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose, closeDisabled: pending });
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
  const canSave = draft.title.trim().length >= 3 && draft.milestoneId && draft.ownerId && draft.accountableProfileId && draft.responsibleProfileIds.length > 0 && draft.goal.trim().length >= 3;

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={draft.id ? "Initiative bearbeiten" : "Neue Initiative"} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
      <form
        className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) onSave(draft);
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Initiative-Brief</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">{draft.id ? "Initiative bearbeiten" : "Neue Initiative"}</h2>
          </div>
          <UiButton onClick={onClose} size="xs" className="text-sm text-slate-600">Schließen</UiButton>
        </div>

        <div className="grid gap-4 px-5 py-4">
          <UiField>
            Titel
            <UiTextInput value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="h-10 px-3" placeholder="z. B. Partnerpraxen-Erstkontaktmaterial" />
          </UiField>

          <div className="grid gap-3 md:grid-cols-2">
            <UiField>
              Epic / Meilenstein
              <CustomSelect value={draft.milestoneId} onChange={(value) => setDraft((current) => ({ ...current, milestoneId: value }))} className="h-10 text-sm" options={data.milestones.map((milestone) => ({ value: milestone.id, label: milestone.title }))} />
            </UiField>
            <UiField>
              Owner
              <CustomSelect
                value={draft.ownerId}
                onChange={(value) => setDraft((current) => ({
                  ...current,
                  ownerId: value,
                  accountableProfileId: current.accountableProfileId || value,
                  responsibleProfileIds: current.responsibleProfileIds.length ? current.responsibleProfileIds : value ? [value] : [],
                }))}
                className="h-10 text-sm"
                options={data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
              />
            </UiField>
            <UiField>
              Priorität
              <CustomSelect value={draft.priority} onChange={(value) => setDraft((current) => ({ ...current, priority: value }))} className="h-10 text-sm" options={["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }))} />
            </UiField>
            <UiField>
              Status
              <CustomSelect value={draft.status} onChange={(value) => setDraft((current) => ({ ...current, status: value as InitiativeDraft["status"] }))} className="h-10 text-sm" options={[
                { value: "planned", label: "Geplant" },
                { value: "active", label: "Aktiv" },
                { value: "done", label: "Erledigt" },
                { value: "paused", label: "Pausiert" },
              ]} />
            </UiField>
            <UiField>
              Zieltermin
              <CustomDatePicker value={draft.targetDate} onChange={(value) => setDraft((current) => ({ ...current, targetDate: value }))} className="h-10 text-sm" />
            </UiField>
          </div>

          <section className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">RACI / Verantwortung</div>
              <p className="mt-1 text-xs leading-5 text-slate-500">Mini-RACI gilt für die Initiative. Deliverables übernehmen diesen Kontext.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <UiField>
                Accountable
                <CustomSelect value={draft.accountableProfileId} onChange={(value) => setDraft((current) => ({ ...current, accountableProfileId: value }))} className="h-10 text-sm" options={data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))} />
              </UiField>
              <UiField>
                Responsible
                <ProfileMultiSelect value={draft.responsibleProfileIds} profiles={data.profiles} onChange={(value) => setDraft((current) => ({ ...current, responsibleProfileIds: value }))} placeholder="Responsible wählen" />
              </UiField>
              <UiField>
                Consulted
                <ProfileMultiSelect value={draft.consultedProfileIds} profiles={data.profiles} onChange={(value) => setDraft((current) => ({ ...current, consultedProfileIds: value }))} placeholder="Consulted wählen" />
              </UiField>
              <UiField>
                Informed
                <ProfileMultiSelect value={draft.informedProfileIds} profiles={data.profiles} onChange={(value) => setDraft((current) => ({ ...current, informedProfileIds: value }))} placeholder="Informed wählen" />
              </UiField>
            </div>
          </section>

          <UiField>
            Ziel / Outcome
            <UiTextArea value={draft.goal} onChange={(event) => setDraft((current) => ({ ...current, goal: event.target.value }))} rows={3} className="px-3" />
          </UiField>
          <UiField>
            Erfolgskriterien
            <UiTextArea value={draft.successCriteria} onChange={(event) => setDraft((current) => ({ ...current, successCriteria: event.target.value }))} rows={3} className="px-3" />
          </UiField>
          <UiField>
            Constraints
            <UiTextArea value={draft.scopeConstraints} onChange={(event) => setDraft((current) => ({ ...current, scopeConstraints: event.target.value }))} rows={3} className="px-3" />
          </UiField>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          {!draft.id && canApproveNow && (
            <label className="mr-auto inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={draft.approveNow} onChange={(event) => setDraft((current) => ({ ...current, approveNow: event.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
              Erstellen und freigeben
            </label>
          )}
          {draft.id && draft.approvalStatus && <span className="mr-auto text-xs text-slate-500">Freigabe: {draft.approvalStatus} · Revision {draft.approvalRevision || 1}{draft.decisionNote ? ` · ${draft.decisionNote}` : ""}</span>}
          <UiButton onClick={onClose}>Abbrechen</UiButton>
          <UiButton type="submit" disabled={pending || !canSave} variant="primary">
            {!draft.id && draft.approveNow ? "Erstellen und freigeben" : "Speichern"}
          </UiButton>
        </div>
      </form>
    </div>
  );
}
