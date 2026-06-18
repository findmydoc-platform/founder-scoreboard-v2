"use client";

import { CommentBody } from "@/features/tasks/atoms/task-comment-body";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { RelationshipList } from "@/features/tasks/molecules/relationship-list";
import { relationTypeLabel } from "@/lib/display";
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
  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-950">Abhängigkeiten & Evidence</h3>
      <div className="mt-2 grid gap-2 text-sm leading-6 text-slate-600">
        <RelationshipList title="Wartet auf" rows={relationshipGroups.waitsOn} empty="Wartet auf keine andere Aufgabe." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
        <RelationshipList title="Blockiert" rows={relationshipGroups.blocks} empty="Blockiert keine andere Aufgabe." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
        <RelationshipList title="Verknüpft mit" rows={relationshipGroups.related} empty="Keine losen Verknüpfungen." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
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
            <input
              value={relationDraft.note}
              onChange={(event) => onRelationDraftChange({ note: event.target.value })}
              className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
              placeholder="Optionaler Hinweis"
            />
            <button
              type="button"
              disabled={pending || !relationDraft.relatedTaskId}
              onClick={() => onAddRelation(relationDraft)}
              className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Relationship hinzufügen
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
