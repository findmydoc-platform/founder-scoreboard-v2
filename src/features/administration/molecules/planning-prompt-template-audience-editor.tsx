"use client";

import { useId, useState } from "react";
import type {
  PlanningPromptTemplateAudienceDirectory,
  PlanningPromptTemplateAudienceEdit,
} from "@/features/planning-items/model/planning-prompt-templates";
import { UiButton, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

export function PlanningPromptTemplateAudienceEditor({ audience, profiles, onSave }: PlanningPromptTemplateAudienceDirectory & {
  onSave: (edit: PlanningPromptTemplateAudienceEdit) => Promise<void>;
}) {
  const titleId = useId();
  const [draft, setDraft] = useState<PlanningPromptTemplateAudienceEdit>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const mode = draft.mode ?? audience.mode;
  const profileIds = draft.profileIds ?? audience.profileIds;
  const isSelected = mode === "selected";
  const edit: PlanningPromptTemplateAudienceEdit = {};

  if (mode !== audience.mode) edit.mode = mode;
  if (isSelected && (profileIds.length !== audience.profileIds.length ||
    profileIds.some(id => !audience.profileIds.includes(id)))) {
    edit.profileIds = profileIds;
  }

  function change(next: PlanningPromptTemplateAudienceEdit) {
    setDraft(current => ({ ...current, ...next }));
    setSaved(false);
    setError("");
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await onSave(edit);
      setDraft({});
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error && failure.message || "Die Zielgruppe konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <UiPanel aria-labelledby={titleId} className="grid min-w-0 gap-4">
      <h2 id={titleId} className="text-lg font-semibold text-slate-950">Zielgruppe</h2>
      <form className="grid min-w-0 gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy} className="min-w-0">
          <legend className="text-sm font-semibold text-slate-800">Wer erhält die aktiven Vorlagen?</legend>
          <div className="flex flex-wrap gap-x-6">
            <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800">
              <input type="radio" name={titleId} checked={isSelected} onChange={() => change({ mode: "selected" })} />
              Ausgewählte Personen
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800">
              <input type="radio" name={titleId} checked={!isSelected} onChange={() => change({ mode: "all" })} />
              Alle
            </label>
          </div>
        </fieldset>
        <fieldset disabled={!isSelected || busy} className="min-w-0">
          <legend className="text-sm font-semibold text-slate-800">Profile</legend>
          <p className="mb-2 text-sm text-slate-600">
            {isSelected
              ? "Ohne ausgewählte Profile erhält niemand die Vorlagen."
              : "Alle mit Zugriff auf den Planungskontext erhalten die Vorlagen. Die Profilauswahl bleibt gespeichert."}
          </p>
          {profiles.length > 0 && (
            <div className="grid max-h-48 overflow-y-auto rounded-md border border-slate-200 px-3 sm:grid-cols-2">
              {profiles.map(profile => {
                const checked = profileIds.includes(profile.id);
                return (
                  <label key={profile.id} className="flex min-h-11 min-w-0 items-center gap-2 pr-2 text-sm text-slate-800 has-disabled:text-slate-600">
                    <input type="checkbox" checked={checked} onChange={() => change({
                      profileIds: checked ? profileIds.filter(id => id !== profile.id) : [...profileIds, profile.id],
                    })} />
                    <span className="min-w-0 break-words">{profile.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
        {error && <UiNotice tone="warning" role="alert">{error}</UiNotice>}
        <div className="flex flex-wrap items-center gap-3">
          <UiButton type="submit" variant="primary" className="min-h-11"
            disabled={busy || (!edit.mode && !edit.profileIds)}
          >{busy ? "Wird gespeichert …" : "Zielgruppe speichern"}</UiButton>
          <p className="text-sm text-slate-600" role="status">{saved ? "Zielgruppe gespeichert." : ""}</p>
        </div>
      </form>
    </UiPanel>
  );
}
