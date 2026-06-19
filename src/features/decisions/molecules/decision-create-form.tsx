import type { FormEvent } from "react";
import type { Profile } from "@/lib/types";
import { UiBadge, UiButton, UiField, UiPanel, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";

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
    <UiPanel id="decision-create" className="scroll-mt-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Neue Decision</h2>
          <p className="mt-1 text-sm text-slate-500">Nur CEO kann Einträge erstellen. Nach Bestätigung aller ausgewählten Personen wird automatisch gelockt.</p>
        </div>
        <UiBadge tone={canCreate ? "blue" : "slate"} size="md" className={canCreate ? "" : "text-slate-500"}>
          {canCreate ? "CEO-Rechte aktiv" : "Read/Confirm"}
        </UiBadge>
      </div>
      <form className="mt-4 grid gap-3" onSubmit={submit}>
        <div className="grid gap-3 lg:grid-cols-2">
          <UiField>
            Titel
            <UiTextInput
              value={title}
              disabled={!canCreate || pending}
              onChange={(event) => onTitleChange(event.target.value)}
              className="h-10 px-3 disabled:opacity-70"
              placeholder="z. B. Malta-Struktur für Sprint 1 freigeben"
            />
          </UiField>
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
        <UiField>
          Kontext
          <UiTextArea
            value={context}
            disabled={!canCreate || pending}
            onChange={(event) => onContextChange(event.target.value)}
            className="min-h-20 px-3 leading-6 disabled:opacity-70"
            placeholder="Warum steht diese Entscheidung jetzt an?"
          />
        </UiField>
        <UiField>
          Entscheidung
          <UiTextArea
            value={decisionText}
            disabled={!canCreate || pending}
            onChange={(event) => onDecisionTextChange(event.target.value)}
            className="min-h-24 px-3 leading-6 disabled:opacity-70"
            placeholder="Was wird konkret entschieden?"
          />
        </UiField>
        <div className="flex justify-end">
          <UiButton
            type="submit"
            disabled={!canCreate || pending || !title.trim() || !decisionText.trim() || !requiredProfileIds.length}
            variant="primary"
            className="px-4"
          >
            Decision öffnen
          </UiButton>
        </div>
      </form>
    </UiPanel>
  );
}
