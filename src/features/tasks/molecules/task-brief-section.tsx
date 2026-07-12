"use client";

import { Pencil, Save, X } from "lucide-react";
import type { ReactNode } from "react";
import { TaskChecklist } from "@/features/tasks/molecules/task-checklist";
import type { Task } from "@/lib/types";
import { UiButton, UiPanel, UiTextInput } from "@/shared/atoms/ui-primitives";

export type TaskBriefState = Pick<Task, "title" | "problemStatement" | "intendedOutcome" | "scopeConstraints" | "acceptanceCriteria" | "evidenceRequired" | "definitionOfDone">;

const briefFields = [
  ["Problem", "problemStatement", "Welches Problem löst diese Aufgabe?"],
  ["Zielbild", "intendedOutcome", "Welcher fertige Zustand soll erreicht sein?"],
  ["Umfang & Grenzen", "scopeConstraints", "Was gehört dazu, was nicht?"],
  ["Abnahmekriterien", "acceptanceCriteria", "Ein messbares Kriterium pro Zeile."],
  ["Nachweis", "evidenceRequired", "Welcher Nachweis wird erwartet?"],
  ["Qualitätsstandard", "definitionOfDone", "Welche Qualität muss vor Abschluss erreicht sein?"],
] as const;

type Props = {
  brief: TaskBriefState;
  canEdit?: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onBriefChange: (patch: Partial<TaskBriefState>) => void;
  onChecklistChange: (patch: Partial<TaskBriefState>) => void;
  children?: ReactNode;
};

export function TaskBriefSection({
  brief,
  canEdit = true,
  editing,
  onEdit,
  onCancel,
  onSave,
  onBriefChange,
  onChecklistChange,
  children,
}: Props) {
  return (
    <UiPanel padding="lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">Aufgabenbrief</h2>
          <p className="text-xs text-slate-500">Problem, Ziel, Scope und Nachweise für die Umsetzung.</p>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                type="button"
                onClick={onCancel}
                className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Bearbeitung abbrechen"
              >
                <X size={15} />
              </button>
              <UiButton
                onClick={onSave}
                variant="blue"
                size="sm"
              >
                <Save size={14} />
                Speichern
              </UiButton>
            </>
          ) : canEdit ? (
            <UiButton
              onClick={onEdit}
              size="sm"
            >
              <Pencil size={14} />
              Bearbeiten
            </UiButton>
          ) : null}
        </div>
      </div>
      <div className="mt-4 grid gap-2 text-sm">
        <div className="font-semibold text-slate-950">Titel</div>
        {editing ? (
          <UiTextInput
            value={brief.title}
            onChange={(event) => onBriefChange({ title: event.target.value })}
            inputPadding="md"
            placeholder="Konkretes Ergebnis"
          />
        ) : (
          <p className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-medium leading-6 text-slate-700">
            {brief.title}
          </p>
        )}
      </div>
      {briefFields.map(([label, key, placeholder]) => (
        <div key={key} className="mt-4 grid gap-2 text-sm">
          <div className="font-semibold text-slate-950">{label}</div>
          {editing ? (
            <textarea
              value={String(brief[key] || "")}
              onChange={(event) => onBriefChange({ [key]: event.target.value } as Partial<TaskBriefState>)}
              className="min-h-20 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 text-slate-800 outline-none focus:border-blue-400"
              placeholder={placeholder}
            />
          ) : (key === "acceptanceCriteria" || key === "definitionOfDone") && canEdit ? (
            <TaskChecklist
              value={String(brief[key] || "")}
              emptyText={placeholder}
              onChange={(nextValue) => onChecklistChange({ [key]: nextValue } as Partial<TaskBriefState>)}
            />
          ) : (
            <p className="whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
              {String(brief[key] || "") || placeholder}
            </p>
          )}
        </div>
      ))}
      {children}
    </UiPanel>
  );
}
