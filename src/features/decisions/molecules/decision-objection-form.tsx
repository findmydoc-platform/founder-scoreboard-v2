import type { FormEvent } from "react";
import { UiButton, UiField, UiTextArea } from "@/shared/atoms/ui-primitives";

type DecisionObjectionFormProps = {
  objectionText: string;
  pending: boolean;
  onObjectionChange: (objectionText: string) => void;
  onSubmit: () => void;
};

export function DecisionObjectionForm({ objectionText, pending, onObjectionChange, onSubmit }: DecisionObjectionFormProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="mt-3 grid gap-2 rounded-md border border-slate-100 bg-white p-3" onSubmit={submit}>
      <UiField>
        Einwand oder Änderungswunsch
        <UiTextArea
          value={objectionText}
          disabled={pending}
          onChange={(event) => onObjectionChange(event.target.value)}
          placeholder="Was ist an der Änderung nicht korrekt oder sollte angepasst werden?"
        />
      </UiField>
      <div className="flex justify-end">
        <UiButton type="submit" disabled={pending || !objectionText.trim()} variant="amber" size="sm">
          Einwand speichern
        </UiButton>
      </div>
    </form>
  );
}
