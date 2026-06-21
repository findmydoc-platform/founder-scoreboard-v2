"use client";

import { CommentBody } from "@/features/tasks/atoms/task-comment-body";
import { RelationshipList } from "@/features/tasks/molecules/relationship-list";
import { TaskRelationshipForm, type TaskRelationshipDraft } from "@/features/tasks/molecules/task-relationship-form";
import { relationMatchesDraft } from "@/lib/relationship-view-model";
import type { TaskRelationshipRows } from "@/features/tasks/model/task-detail-state";
import type { Task, TaskRelation } from "@/lib/types";

type Props = {
  task: Task;
  relationshipGroups: TaskRelationshipRows;
  relationDraft: TaskRelationshipDraft;
  relationTargetOptions: Array<{ value: string; label: string }>;
  canManageTaskMeta: boolean;
  pending: boolean;
  onRelationDraftChange: (patch: Partial<TaskRelationshipDraft>) => void;
  onAddRelation: (draft: TaskRelationshipDraft) => void;
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
          <TaskRelationshipForm
            relationDraft={relationDraft}
            relationTargetOptions={relationTargetOptions}
            duplicateRelation={duplicateRelation}
            pending={pending}
            className="mt-2 grid gap-2 rounded-md border border-slate-200 bg-white p-3"
            onRelationDraftChange={onRelationDraftChange}
            onAddRelation={() => onAddRelation(relationDraft)}
          />
        )}
      </div>
    </section>
  );
}
