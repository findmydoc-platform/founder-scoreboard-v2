import type { FormEvent } from "react";
import type { Profile } from "@/lib/types";

type DecisionCreateFormProps = {
  canCreate: boolean;
  context: string;
  decisionText: string;
  pending: boolean;
  profiles: Profile[];
  requiredProfileIds: string[];
  title: string;
  onContextChange: (context: string) => void;
  onDecisionTextChange: (decisionText: string) => void;
  onRequiredProfileIdsChange: (requiredProfileIds: string[]) => void;
  onSubmit: () => void;
  onTitleChange: (title: string) => void;
};

export function DecisionCreateForm({
  canCreate,
  context,
  decisionText,
  pending,
  profiles,
  requiredProfileIds,
  title,
  onContextChange,
  onDecisionTextChange,
  onRequiredProfileIdsChange,
  onSubmit,
  onTitleChange,
}: DecisionCreateFormProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate || pending) return;
    onSubmit();
  };

  return (
    <section id="decision-create" className="scroll-mt-24 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Neue Decision</h2>
          <p className="mt-1 text-sm text-slate-500">Nur CEO kann Einträge erstellen. Nach Bestätigung aller ausgewählten Personen wird automatisch gelockt.</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${canCreate ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
          {canCreate ? "CEO-Rechte aktiv" : "Read/Confirm"}
        </span>
      </div>
      <form className="mt-4 grid gap-3" onSubmit={submit}>
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Titel
            <input
              value={title}
              disabled={!canCreate || pending}
              onChange={(event) => onTitleChange(event.target.value)}
              className="h-10 rounded-md border border-slate-200 px-3 text-sm font-normal text-slate-900 disabled:bg-slate-50 disabled:opacity-70"
              placeholder="z. B. Malta-Struktur für Sprint 1 freigeben"
            />
          </label>
          <fieldset className="grid gap-2 text-xs font-semibold text-slate-500">
            Bestätigung erforderlich von
            <div className="flex flex-wrap gap-2">
              {profiles.map((profile) => {
                const checked = requiredProfileIds.includes(profile.id);
                return (
                  <label key={profile.id} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canCreate || pending}
                      onChange={(event) => {
                        onRequiredProfileIdsChange(
                          event.target.checked ? [...requiredProfileIds, profile.id] : requiredProfileIds.filter((id) => id !== profile.id),
                        );
                      }}
                    />
                    {profile.name}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
        <label className="grid gap-1 text-xs font-semibold text-slate-500">
          Kontext
          <textarea
            value={context}
            disabled={!canCreate || pending}
            onChange={(event) => onContextChange(event.target.value)}
            className="min-h-20 resize-y rounded-md border border-slate-200 px-3 py-2 text-sm font-normal leading-6 text-slate-900 disabled:bg-slate-50 disabled:opacity-70"
            placeholder="Warum steht diese Entscheidung jetzt an?"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-500">
          Entscheidung
          <textarea
            value={decisionText}
            disabled={!canCreate || pending}
            onChange={(event) => onDecisionTextChange(event.target.value)}
            className="min-h-24 resize-y rounded-md border border-slate-200 px-3 py-2 text-sm font-normal leading-6 text-slate-900 disabled:bg-slate-50 disabled:opacity-70"
            placeholder="Was wird konkret entschieden?"
          />
        </label>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!canCreate || pending || !title.trim() || !decisionText.trim() || !requiredProfileIds.length}
            className="h-9 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Decision öffnen
          </button>
        </div>
      </form>
    </section>
  );
}
