import type { FormEvent } from "react";
import type { DecisionEditDraft } from "@/features/decisions/model/decision-log-view-model";
import type { Profile } from "@/lib/types";

type DecisionEditFormProps = {
  draft: DecisionEditDraft;
  pending: boolean;
  profiles: Profile[];
  onDraftChange: (draft: DecisionEditDraft) => void;
  onSubmit: () => void;
};

export function DecisionEditForm({ draft, pending, profiles, onDraftChange, onSubmit }: DecisionEditFormProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="mt-4 grid gap-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3" onSubmit={submit}>
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-slate-500">
          Titel
          <input value={draft.title} disabled={pending} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} className="h-9 rounded-md border border-slate-200 px-2 text-sm font-normal text-slate-900" />
        </label>
        <fieldset className="grid gap-2 text-xs font-semibold text-slate-500">
          Neue Bestätigung erforderlich von
          <div className="flex flex-wrap gap-2">
            {profiles.map((profile) => (
              <label key={profile.id} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.requiredProfileIds.includes(profile.id)}
                  disabled={pending}
                  onChange={(event) => onDraftChange({
                    ...draft,
                    requiredProfileIds: event.target.checked
                      ? [...draft.requiredProfileIds, profile.id]
                      : draft.requiredProfileIds.filter((id) => id !== profile.id),
                  })}
                />
                {profile.name}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <label className="grid gap-1 text-xs font-semibold text-slate-500">
        Kontext
        <textarea value={draft.context} disabled={pending} onChange={(event) => onDraftChange({ ...draft, context: event.target.value })} className="min-h-16 rounded-md border border-slate-200 px-2 py-2 text-sm font-normal text-slate-900" />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-slate-500">
        Entscheidung
        <textarea value={draft.decision} disabled={pending} onChange={(event) => onDraftChange({ ...draft, decision: event.target.value })} className="min-h-20 rounded-md border border-slate-200 px-2 py-2 text-sm font-normal text-slate-900" />
      </label>
      <div className="flex justify-end">
        <button type="submit" disabled={pending || !draft.title.trim() || !draft.decision.trim() || !draft.requiredProfileIds.length} className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50">
          Änderung speichern
        </button>
      </div>
      <p className="text-xs leading-5 text-slate-500">Speichern setzt vorhandene Bestätigungen zurück und schreibt vorher/nachher ins Audit.</p>
    </form>
  );
}
