"use client";

import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiButton, UiTextInput } from "@/shared/atoms/ui-primitives";
import { RelationshipList } from "@/features/tasks/molecules/relationship-list";
import { relationTypeLabel } from "@/lib/display";
import { relationMatchesDraft } from "@/lib/relationship-view-model";
import type { Task, TaskRelation, TaskRelationType } from "@/lib/types";

export type TaskRelationshipDraft = {
  relationType: TaskRelationType;
  relatedTaskId: string;
  note: string;
};

type Props = {
  task: Task;
  waitsOn: Array<{ relation: TaskRelation; task?: Task }>;
  blocks: Array<{ relation: TaskRelation; task?: Task }>;
  related: Array<{ relation: TaskRelation; task?: Task }>;
  dependsOn: string;
  relationDraft: TaskRelationshipDraft;
  relationTargetOptions: Array<{ value: string; label: string }>;
  canManageTaskMeta: boolean;
  pending: boolean;
  onRemoveRelation: (relation: TaskRelation) => void;
  onDependsOnChange: (dependsOn: string) => void;
  onDependsOnSave: () => void;
  onRelationDraftChange: (patch: Partial<TaskRelationshipDraft>) => void;
  onAddRelation: () => void;
};

export function TaskRelationshipsSection({
  task,
  waitsOn,
  blocks,
  related,
  dependsOn,
  relationDraft,
  relationTargetOptions,
  canManageTaskMeta,
  pending,
  onRemoveRelation,
  onDependsOnChange,
  onDependsOnSave,
  onRelationDraftChange,
  onAddRelation,
}: Props) {
  const relationshipRows = [...waitsOn, ...blocks, ...related];
  const duplicateRelation = Boolean(relationDraft.relatedTaskId) && relationshipRows.some(({ relation }) => relationMatchesDraft(task.id, relation, relationDraft));

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-950">Relationships</h3>
      <div className="mt-2 grid gap-2">
        <RelationshipList title="Wartet auf" currentTask={task} rows={waitsOn} empty="Wartet auf keine andere Aufgabe." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
        <RelationshipList title="Blockiert" currentTask={task} rows={blocks} empty="Blockiert keine andere Aufgabe." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
        <RelationshipList title="Verknüpft mit" currentTask={task} rows={related} empty="Keine losen Verknüpfungen." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
      </div>
      {dependsOn && (
        <textarea
          value={dependsOn}
          onChange={(event) => onDependsOnChange(event.target.value)}
          onBlur={onDependsOnSave}
          className="mt-2 min-h-16 w-full resize-y rounded-md border border-amber-100 bg-amber-50 p-3 text-xs leading-5 text-amber-800 outline-none focus:border-amber-300"
          placeholder="Legacy-Notiz"
        />
      )}
      {canManageTaskMeta && (
        <div className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
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
      )}
    </div>
  );
}
