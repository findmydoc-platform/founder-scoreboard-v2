"use client";

import { Link2, Pencil, Plus, X } from "lucide-react";
import type { FormEvent } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import type { FmdTool, Profile } from "@/lib/types";
import {
  fmdToolCategoryOptions,
  maxCuratedFmdToolLinks,
  type FmdToolDraft,
} from "@/features/tools/model/fmd-tools";
import type { FmdToolDialogMode } from "@/features/tools/model/fmd-tool-registry-view";
import {
  classNames,
  UiButton,
  UiField,
  UiNotice,
  UiTextArea,
  UiTextInput,
} from "@/shared/atoms/ui-primitives";

export function FmdToolRegistryDialog({
  mode,
  draft,
  pending,
  currentProfile,
  curatedLinkCount,
  curatedLimitReached,
  onClose,
  onDraftChange,
  onSubmit,
}: {
  mode: FmdToolDialogMode;
  draft: FmdToolDraft;
  pending: boolean;
  currentProfile: Profile | null;
  curatedLinkCount: number;
  curatedLimitReached: boolean;
  onClose: () => void;
  onDraftChange: (draft: FmdToolDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const title = mode === "edit" ? "Tool bearbeiten" : "Tool eintragen";
  const submitLabel = mode === "edit" ? "Speichern" : "Eintragen";
  const patchDraft = (patch: Partial<FmdToolDraft>) => onDraftChange({ ...draft, ...patch });
  const linkPresent = Boolean(draft.url.trim());
  const curateDisabled = pending || (!draft.isCurated && (!linkPresent || curatedLimitReached));
  const curatedWarning = linkPresent && curatedLimitReached && !draft.isCurated
      ? `Es sind bereits ${maxCuratedFmdToolLinks} kuratierte Links gesetzt.`
      : "";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-4 py-6" role="dialog" aria-modal="true" aria-label={title}>
      <form onSubmit={onSubmit} className="max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-2xl lg:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
          </div>
          <UiButton type="button" onClick={onClose} disabled={pending} size="iconXs" className="text-slate-500" aria-label="Dialog schließen">
            <X size={16} />
          </UiButton>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <UiField>
            Name
            <UiTextInput
              value={draft.name}
              onChange={(event) => patchDraft({ name: event.target.value })}
              inputSize="lg"
              inputPadding="md"
              required
              minLength={2}
              placeholder="z. B. Angebotsrechner"
            />
          </UiField>
          <UiField as="div">
            Kategorie
            <CustomSelect
              value={draft.category}
              onChange={(value) => patchDraft({ category: value as FmdTool["category"] })}
              className="h-10 text-sm"
              options={fmdToolCategoryOptions}
            />
          </UiField>
          <UiField>
            Owner
            <UiTextInput
              value={draft.owner}
              onChange={(event) => patchDraft({ owner: event.target.value })}
              inputSize="lg"
              inputPadding="md"
              placeholder={currentProfile?.name || "Team"}
            />
          </UiField>
          <UiField>
            Link
            <UiTextInput
              value={draft.url}
              onChange={(event) => {
                const url = event.target.value;
                patchDraft({ url, isCurated: url.trim() ? draft.isCurated : false });
              }}
              inputSize="lg"
              inputPadding="md"
              type="url"
              placeholder="https://..."
            />
          </UiField>
          <div className="grid gap-2 lg:col-span-2">
            <button
              type="button"
              role="switch"
              aria-checked={draft.isCurated}
              disabled={curateDisabled}
              onClick={() => patchDraft({ isCurated: !draft.isCurated })}
              className={classNames(
                "flex min-w-0 items-center justify-between gap-4 rounded-md border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                draft.isCurated ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Link2 size={16} className="shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">In kuratierte Links aufnehmen</span>
                  <span className="block text-xs text-slate-500">{curatedLinkCount}/{maxCuratedFmdToolLinks} belegt</span>
                </span>
              </span>
              <span className={classNames("relative h-5 w-9 rounded-full transition", draft.isCurated ? "bg-blue-600" : "bg-slate-200")}>
                <span className={classNames("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition", draft.isCurated ? "left-4" : "left-0.5")} />
              </span>
            </button>
            {curatedWarning && <UiNotice tone="warning" size="compact">{curatedWarning}</UiNotice>}
          </div>
          <UiField className="lg:col-span-2">
            Beschreibung
            <UiTextArea
              value={draft.description}
              onChange={(event) => patchDraft({ description: event.target.value })}
              minHeight="md"
              inputPadding="mdBlock"
              required
              minLength={8}
              placeholder="Wofür wird das Werkzeug genutzt?"
            />
          </UiField>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          <UiButton type="button" onClick={onClose} disabled={pending} variant="secondary">Abbrechen</UiButton>
          <UiButton type="submit" variant="primary" disabled={pending}>
            {mode === "edit" ? <Pencil size={16} /> : <Plus size={16} />}
            {pending ? "Speichert..." : submitLabel}
          </UiButton>
        </div>
      </form>
    </div>
  );
}
