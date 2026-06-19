"use client";

import { Pencil, Save, X } from "lucide-react";
import type { ReactNode } from "react";
import { TaskChecklist } from "@/features/tasks/molecules/task-checklist";
import { taskOwnerLabel } from "@/lib/display";
import type { Profile, Task } from "@/lib/types";
import { UiButton, UiPanel } from "@/shared/atoms/ui-primitives";

export type TaskBriefState = Pick<Task, "problemStatement" | "intendedOutcome" | "scopeConstraints" | "acceptanceCriteria" | "evidenceRequired" | "definitionOfDone">;

const briefFields = [
  ["Problem Statement", "problemStatement", "Welches Problem löst diese Aufgabe?"],
  ["Intended Outcome", "intendedOutcome", "Welcher fertige Zustand soll erreicht sein?"],
  ["Scope & Constraints", "scopeConstraints", "Was gehört dazu, was nicht?"],
  ["Acceptance Criteria", "acceptanceCriteria", "Ein messbares Kriterium pro Zeile."],
  ["Evidence Required", "evidenceRequired", "Welcher Nachweis wird erwartet?"],
  ["Definition of Done", "definitionOfDone", "Allgemeiner Qualitätsstandard oder DoD-Snapshot."],
] as const;

function ProfileAvatar({ profile }: { profile?: Profile }) {
  const login = profile?.githubLogin || "";
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
      {login ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://github.com/${login}.png?size=72`} alt="" className="h-full w-full object-cover" />
      ) : (
        profile?.name?.slice(0, 1).toUpperCase() || "?"
      )}
    </span>
  );
}

type Props = {
  task: Task;
  brief: TaskBriefState;
  creatorProfile?: Profile;
  ownerProfile?: Profile;
  owner: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onBriefChange: (patch: Partial<TaskBriefState>) => void;
  onChecklistChange: (patch: Partial<TaskBriefState>) => void;
  children?: ReactNode;
};

export function TaskBriefSection({
  task,
  brief,
  creatorProfile,
  ownerProfile,
  owner,
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
        <div className="flex items-center gap-3">
          <ProfileAvatar profile={creatorProfile} />
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Aufgabenbrief</h2>
            <p className="text-xs text-slate-500">Erstellt von {creatorProfile?.name || task.createdBy || "Unbekannt"} · Assignee {ownerProfile?.name || taskOwnerLabel({ owner })} · {task.dodTemplateVersion || "founder-deliverable-v2"}</p>
          </div>
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
          ) : (
            <UiButton
              onClick={onEdit}
              size="sm"
            >
              <Pencil size={14} />
              Bearbeiten
            </UiButton>
          )}
        </div>
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
          ) : key === "acceptanceCriteria" || key === "definitionOfDone" ? (
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
