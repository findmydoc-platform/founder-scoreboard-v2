import type { FormEvent } from "react";

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
      <label className="grid gap-1 text-xs font-semibold text-slate-500">
        Einwand oder Änderungswunsch
        <textarea
          value={objectionText}
          disabled={pending}
          onChange={(event) => onObjectionChange(event.target.value)}
          className="min-h-16 rounded-md border border-slate-200 px-2 py-2 text-sm font-normal text-slate-900"
          placeholder="Was ist an der Änderung nicht korrekt oder sollte angepasst werden?"
        />
      </label>
      <div className="flex justify-end">
        <button type="submit" disabled={pending || !objectionText.trim()} className="h-8 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700 disabled:opacity-50">
          Einwand speichern
        </button>
      </div>
    </form>
  );
}
