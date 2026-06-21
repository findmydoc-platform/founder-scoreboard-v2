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
  duplicateRelation: boolean;
  pending: boolean;
  className: string;
  onRelationDraftChange: (patch: Partial<TaskRelationshipDraft>) => void;
  onAddRelation: () => void;
};

export function TaskRelationshipForm({
  relationDraft,
  relationTargetOptions,
  duplicateRelation,
  pending,
  className,
  onRelationDraftChange,
  onAddRelation,
}: TaskRelationshipFormProps) {
  return (
    <div className={className}>
      <div className="text-xs font-semibold text-slate-500">Relationship hinzufügen</div>
      <CustomSelect
        value={relationDraft.relationType}
        onChange={(value) => onRelationDraftChange({ relationType: value as TaskRelationType })}
        className="h-9 text-sm"
        options={(["blocked_by", "blocks", "relates_to"] as TaskRelationType[]).map((type) => ({ value: type, label: relationTypeLabel(type) }))}
      />
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
        {duplicateRelation ? "Relationship existiert bereits" : "Relationship hinzufügen"}
      </UiButton>
      {duplicateRelation && <div className="text-xs font-semibold text-amber-700">Diese Relationship ist bereits gespeichert.</div>}
    </div>
  );
}
