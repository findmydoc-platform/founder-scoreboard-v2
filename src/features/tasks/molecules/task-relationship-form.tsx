"use client";

import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiButton, UiTextInput } from "@/shared/atoms/ui-primitives";
import { relationTypeLabel } from "@/lib/display";
import type { TaskRelationType } from "@/lib/types";

export type TaskRelationshipDraft = {
  relationType: TaskRelationType;
  relatedTaskId: string;
  note: string;
};

type TaskRelationshipFormProps = {
  relationDraft: TaskRelationshipDraft;
  relationTargetOptions: Array<{ value: string; label: string }>;
  allowedRelationTypes: TaskRelationType[];
  duplicateRelation: boolean;
  pending: boolean;
  error?: string;
  className: string;
  onRelationDraftChange: (patch: Partial<TaskRelationshipDraft>) => void;
  onAddRelation: () => void;
};

export function TaskRelationshipForm({
  relationDraft,
  relationTargetOptions,
  allowedRelationTypes,
  duplicateRelation,
  pending,
  error = "",
  className,
  onRelationDraftChange,
  onAddRelation,
}: TaskRelationshipFormProps) {
  return (
    <form
      className={className}
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || !relationDraft.relatedTaskId || duplicateRelation) return;
        onAddRelation();
      }}
    >
      <div className="text-xs font-semibold text-slate-500">Abhängigkeit hinzufügen</div>
      {allowedRelationTypes.length > 1 ? (
        <CustomSelect
          value={relationDraft.relationType}
          onChange={(value) => onRelationDraftChange({ relationType: value as TaskRelationType })}
          disabled={pending}
          className="h-9 text-sm"
          aria-label="Beziehungsrichtung"
          options={allowedRelationTypes.map((type) => ({ value: type, label: relationTypeLabel(type) }))}
        />
      ) : (
        <div className="flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700">
          {relationTypeLabel(allowedRelationTypes[0] || "blocked_by")}
        </div>
      )}
      <CustomSelect
        value={relationDraft.relatedTaskId}
        onChange={(value) => onRelationDraftChange({ relatedTaskId: value })}
        disabled={pending}
        className="h-9 text-sm"
        aria-label="Verknüpftes Item"
        options={[{ value: "", label: "Aufgabe auswählen" }, ...relationTargetOptions]}
      />
      <UiTextInput
        value={relationDraft.note}
        onChange={(event) => onRelationDraftChange({ note: event.target.value })}
        disabled={pending}
        inputPadding="md"
        aria-label="Optionaler Beziehungshinweis"
        placeholder="Optionaler Hinweis"
      />
      {error ? <div id="task-relationship-error" tabIndex={-1} role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 outline-none focus:ring-2 focus:ring-red-400">{error}</div> : null}
      <UiButton
        type="submit"
        disabled={pending || !relationDraft.relatedTaskId || duplicateRelation}
        variant="primary"
      >
        {pending ? "Wird hinzugefügt …" : duplicateRelation ? "Abhängigkeit existiert bereits" : "Abhängigkeit hinzufügen"}
      </UiButton>
      {duplicateRelation && <div className="text-xs font-semibold text-amber-700">Diese Abhängigkeit ist bereits gespeichert.</div>}
    </form>
  );
}
