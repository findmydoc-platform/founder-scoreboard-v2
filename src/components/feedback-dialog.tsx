import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { CustomSelect } from "@/components/custom-select";

export type FeedbackDraft = {
  type: "bug" | "feature";
  severity: "P0" | "P1" | "P2" | "P3";
  title: string;
  description: string;
  pageUrl: string;
};

export function FeedbackDialog({
  pending,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (draft: FeedbackDraft) => void;
}) {
  const [draft, setDraft] = useState<FeedbackDraft>({
    type: "bug",
    severity: "P2",
    title: "",
    description: "",
    pageUrl: typeof window === "undefined" ? "" : window.location.href,
  });
  const canSubmit = draft.title.trim().length >= 3 && draft.description.trim().length >= 10;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 py-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="w-full max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit(draft);
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team-Feedback</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Bug oder Feature-Wunsch melden</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Feedback schließen">
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Typ
              <CustomSelect
                value={draft.type}
                onChange={(value) => setDraft((current) => ({ ...current, type: value as FeedbackDraft["type"] }))}
                className="h-9 text-sm"
                options={[{ value: "bug", label: "Bug" }, { value: "feature", label: "Feature-Wunsch" }]}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Priorität
              <CustomSelect
                value={draft.severity}
                onChange={(value) => setDraft((current) => ({ ...current, severity: value as FeedbackDraft["severity"] }))}
                className="h-9 text-sm"
                options={["P0", "P1", "P2", "P3"].map((value) => ({ value, label: value }))}
              />
            </label>
          </div>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Titel
            <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="h-10 rounded-md border border-slate-200 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400" placeholder="Kurz beschreiben, was aufgefallen ist" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Beschreibung
            <textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="min-h-32 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Was ist passiert, was hast du erwartet, und wo genau im Tool?" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Kontextseite
            <input value={draft.pageUrl} onChange={(event) => setDraft((current) => ({ ...current, pageUrl: event.target.value }))} className="h-10 rounded-md border border-slate-200 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400" placeholder="URL oder Bereich im Tool" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">Abbrechen</button>
          <button type="submit" disabled={pending || !canSubmit} className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Senden</button>
        </div>
      </form>
    </div>
  );
}
