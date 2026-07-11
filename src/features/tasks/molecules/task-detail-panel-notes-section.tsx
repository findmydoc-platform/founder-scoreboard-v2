"use client";

type Props = {
  canEdit?: boolean;
  note: string;
  pending: boolean;
  onChange: (note: string) => void;
  onSave: () => void;
};

export function TaskDetailPanelNotesSection({ canEdit = true, note, pending, onChange, onSave }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-950">Notizen</h3>
      <textarea
        value={note}
        disabled={!canEdit || pending}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onSave}
        className="mt-2 min-h-28 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-500"
        placeholder="Interne Notiz, Entscheidung oder nächster Schritt"
      />
      {canEdit && <div className="mt-2 text-xs text-slate-500">{pending ? "Speichert..." : "Speichert beim Verlassen des Feldes."}</div>}
    </section>
  );
}
