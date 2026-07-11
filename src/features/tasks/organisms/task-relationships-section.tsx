"use client";

import { RelationshipList } from "@/features/tasks/molecules/relationship-list";
import { TaskRelationshipForm, type TaskRelationshipDraft } from "@/features/tasks/molecules/task-relationship-form";
import { relationMatchesDraft } from "@/lib/relationship-view-model";
import type { Task, TaskRelation, TaskRelationType } from "@/lib/types";

type Props = {
  task: Task;
  waitsOn: Array<{ relation: TaskRelation; task?: Task }>;
  blocks: Array<{ relation: TaskRelation; task?: Task }>;
  related: Array<{ relation: TaskRelation; task?: Task }>;
  dependsOn: string;
  relationDraft: TaskRelationshipDraft;
  relationTargetOptions: Array<{ value: string; label: string }>;
  allowedRelationTypes: TaskRelationType[];
  pending: boolean;
  onRemoveRelation: (relation: TaskRelation) => void;
  canRemoveRelation: (relation: TaskRelation) => boolean;
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
  allowedRelationTypes,
  pending,
  onRemoveRelation,
  canRemoveRelation,
  onDependsOnChange,
  onDependsOnSave,
  onRelationDraftChange,
  onAddRelation,
}: Props) {
  const relationshipRows = [...waitsOn, ...blocks, ...related];
  const duplicateRelation = Boolean(relationDraft.relatedTaskId) && relationshipRows.some(({ relation }) => relationMatchesDraft(task.id, relation, relationDraft));

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-950">Abhängigkeiten</h3>
      <div className="mt-2 grid gap-2">
        <RelationshipList title="Wartet auf" currentTask={task} rows={waitsOn} empty="Wartet auf keine andere Aufgabe." canRemove={canRemoveRelation} onRemove={onRemoveRelation} />
        <RelationshipList title="Blockiert" currentTask={task} rows={blocks} empty="Blockiert keine andere Aufgabe." canRemove={canRemoveRelation} onRemove={onRemoveRelation} />
        <RelationshipList title="Verknüpft mit" currentTask={task} rows={related} empty="Keine losen Verknüpfungen." canRemove={canRemoveRelation} onRemove={onRemoveRelation} />
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
      {allowedRelationTypes.length > 0 && (
        <TaskRelationshipForm
          relationDraft={relationDraft}
          relationTargetOptions={relationTargetOptions}
          allowedRelationTypes={allowedRelationTypes}
          duplicateRelation={duplicateRelation}
          pending={pending}
          className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3"
          onRelationDraftChange={onRelationDraftChange}
          onAddRelation={onAddRelation}
        />
      )}
    </div>
  );
}
