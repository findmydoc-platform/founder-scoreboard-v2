"use client";

import { useState } from "react";
import { CustomDatePicker } from "@/components/custom-date-picker";
import { CustomSelect } from "@/components/custom-select";
import { ProfileMultiSelect } from "@/components/profile-multi-select";
import type { Package, PlanningData } from "@/lib/types";

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
};

export function InitiativeDialog({
  defaults,
  data,
  pending,
  onClose,
  onSave,
}: {
  defaults: Partial<InitiativeDraft>;
  data: PlanningData;
  pending: boolean;
  onClose: () => void;
  onSave: (draft: InitiativeDraft) => void;
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
  });
  const canSave = draft.title.trim().length >= 3 && draft.milestoneId && draft.ownerId && draft.accountableProfileId && draft.responsibleProfileIds.length > 0 && draft.goal.trim().length >= 3;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
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
          <button type="button" onClick={onClose} className="h-8 rounded-md border border-slate-200 px-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Schließen</button>
        </div>

        <div className="grid gap-4 px-5 py-4">
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Titel
            <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="h-10 rounded-md border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:border-blue-400" placeholder="z. B. Partnerpraxen-Erstkontaktmaterial" />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Epic / Meilenstein
              <CustomSelect value={draft.milestoneId} onChange={(value) => setDraft((current) => ({ ...current, milestoneId: value }))} className="h-10 text-sm" options={data.milestones.map((milestone) => ({ value: milestone.id, label: milestone.title }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
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
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Priorität
              <CustomSelect value={draft.priority} onChange={(value) => setDraft((current) => ({ ...current, priority: value }))} className="h-10 text-sm" options={["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Status
              <CustomSelect value={draft.status} onChange={(value) => setDraft((current) => ({ ...current, status: value as InitiativeDraft["status"] }))} className="h-10 text-sm" options={[
                { value: "planned", label: "Geplant" },
                { value: "active", label: "Aktiv" },
                { value: "done", label: "Erledigt" },
                { value: "paused", label: "Pausiert" },
              ]} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Zieltermin
              <CustomDatePicker value={draft.targetDate} onChange={(value) => setDraft((current) => ({ ...current, targetDate: value }))} className="h-10 text-sm" />
            </label>
          </div>

          <section className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">RACI / Verantwortung</div>
              <p className="mt-1 text-xs leading-5 text-slate-500">Mini-RACI gilt für die Initiative. Deliverables übernehmen diesen Kontext.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Accountable
                <CustomSelect value={draft.accountableProfileId} onChange={(value) => setDraft((current) => ({ ...current, accountableProfileId: value }))} className="h-10 text-sm" options={data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Responsible
                <ProfileMultiSelect value={draft.responsibleProfileIds} profiles={data.profiles} onChange={(value) => setDraft((current) => ({ ...current, responsibleProfileIds: value }))} placeholder="Responsible wählen" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Consulted
                <ProfileMultiSelect value={draft.consultedProfileIds} profiles={data.profiles} onChange={(value) => setDraft((current) => ({ ...current, consultedProfileIds: value }))} placeholder="Consulted wählen" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Informed
                <ProfileMultiSelect value={draft.informedProfileIds} profiles={data.profiles} onChange={(value) => setDraft((current) => ({ ...current, informedProfileIds: value }))} placeholder="Informed wählen" />
              </label>
            </div>
          </section>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Ziel / Outcome
            <textarea value={draft.goal} onChange={(event) => setDraft((current) => ({ ...current, goal: event.target.value }))} rows={3} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Erfolgskriterien
            <textarea value={draft.successCriteria} onChange={(event) => setDraft((current) => ({ ...current, successCriteria: event.target.value }))} rows={3} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Constraints
            <textarea value={draft.scopeConstraints} onChange={(event) => setDraft((current) => ({ ...current, scopeConstraints: event.target.value }))} rows={3} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400" />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">Abbrechen</button>
          <button type="submit" disabled={pending || !canSave} className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            Speichern
          </button>
        </div>
      </form>
    </div>
  );
}
