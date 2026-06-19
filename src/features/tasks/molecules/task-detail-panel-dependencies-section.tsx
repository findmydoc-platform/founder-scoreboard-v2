"use client";

import { CommentBody } from "@/features/tasks/atoms/task-comment-body";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { RelationshipList } from "@/features/tasks/molecules/relationship-list";
import { UiButton, UiTextInput } from "@/shared/atoms/ui-primitives";
import { relationTypeLabel } from "@/lib/display";
import { relationMatchesDraft } from "@/lib/relationship-view-model";
import type { Task, TaskRelation, TaskRelationType } from "@/lib/types";

type RelationshipRows = {
  waitsOn: Array<{ relation: TaskRelation; task?: Task }>;
  blocks: Array<{ relation: TaskRelation; task?: Task }>;
  related: Array<{ relation: TaskRelation; task?: Task }>;
};

type RelationDraft = {
  relationType: TaskRelationType;
  relatedTaskId: string;
  note: string;
};

type Props = {
  task: Task;
  relationshipGroups: RelationshipRows;
  relationDraft: RelationDraft;
  relationTargetOptions: Array<{ value: string; label: string }>;
  canManageTaskMeta: boolean;
  pending: boolean;
  onRelationDraftChange: (patch: Partial<RelationDraft>) => void;
  onAddRelation: (draft: RelationDraft) => void;
  onRemoveRelation: (relation: TaskRelation) => void;
};

export function TaskDetailPanelDependenciesSection({
  task,
  relationshipGroups,
  relationDraft,
  relationTargetOptions,
  canManageTaskMeta,
  pending,
  onRelationDraftChange,
  onAddRelation,
  onRemoveRelation,
}: Props) {
  const relationshipRows = [
    ...relationshipGroups.waitsOn,
    ...relationshipGroups.blocks,
    ...relationshipGroups.related,
  ];
  const duplicateRelation = Boolean(relationDraft.relatedTaskId) && relationshipRows.some(({ relation }) => relationMatchesDraft(task.id, relation, relationDraft));

  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-950">Abhängigkeiten & Evidence</h3>
      <div className="mt-2 grid gap-2 text-sm leading-6 text-slate-600">
        <RelationshipList title="Wartet auf" currentTask={task} rows={relationshipGroups.waitsOn} empty="Wartet auf keine andere Aufgabe." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
        <RelationshipList title="Blockiert" currentTask={task} rows={relationshipGroups.blocks} empty="Blockiert keine andere Aufgabe." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
        <RelationshipList title="Verknüpft mit" currentTask={task} rows={relationshipGroups.related} empty="Keine losen Verknüpfungen." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
        {task.dependsOn && <p className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">Legacy-Notiz: {task.dependsOn}</p>}
        {task.evidenceLink || task.issueUrl ? (
          <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
            <CommentBody value={task.evidenceLink || task.issueUrl} />
          </div>
        ) : (
          <p>Noch kein Evidence-Link hinterlegt.</p>
        )}
        {canManageTaskMeta && (
          <div className="mt-2 grid gap-2 rounded-md border border-slate-200 bg-white p-3">
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
              onClick={() => onAddRelation(relationDraft)}
              variant="primary"
            >
              {duplicateRelation ? "Relationship existiert bereits" : "Relationship hinzufügen"}
            </UiButton>
            {duplicateRelation && <div className="text-xs font-semibold text-amber-700">Diese Relationship ist bereits gespeichert.</div>}
          </div>
        )}
      </div>
    </section>
  );
}
