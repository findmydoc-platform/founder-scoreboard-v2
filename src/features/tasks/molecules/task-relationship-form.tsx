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
  className,
  onRelationDraftChange,
  onAddRelation,
}: TaskRelationshipFormProps) {
  return (
    <div className={className}>
      <div className="text-xs font-semibold text-slate-500">Abhängigkeit hinzufügen</div>
      {allowedRelationTypes.length > 1 ? (
        <CustomSelect
          value={relationDraft.relationType}
          onChange={(value) => onRelationDraftChange({ relationType: value as TaskRelationType })}
          className="h-9 text-sm"
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
        className="h-9 text-sm"
        options={[{ value: "", label: "Aufgabe auswählen" }, ...relationTargetOptions]}
      />
      <UiTextInput
        value={relationDraft.note}
        onChange={(event) => onRelationDraftChange({ note: event.target.value })}
        inputPadding="md"
        placeholder="Optionaler Hinweis"
      />
      <UiButton
        type="button"
        disabled={pending || !relationDraft.relatedTaskId || duplicateRelation}
        onClick={onAddRelation}
        variant="primary"
      >
        {duplicateRelation ? "Abhängigkeit existiert bereits" : "Abhängigkeit hinzufügen"}
      </UiButton>
      {duplicateRelation && <div className="text-xs font-semibold text-amber-700">Diese Abhängigkeit ist bereits gespeichert.</div>}
    </div>
  );
}
