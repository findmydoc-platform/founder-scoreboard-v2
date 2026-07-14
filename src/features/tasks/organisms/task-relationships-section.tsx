"use client";

import { GitBranch, Plus, X } from "lucide-react";
import { useState } from "react";
import { RelationshipList } from "@/features/tasks/molecules/relationship-list";
import { TaskRelationshipForm, type TaskRelationshipDraft } from "@/features/tasks/molecules/task-relationship-form";
import { relationMatchesDraft } from "@/lib/relationship-view-model";
import type { Task, TaskRelation, TaskRelationType } from "@/lib/types";
import { UiButton, UiEmptyState } from "@/shared/atoms/ui-primitives";

type Props = {
  task: Task;
  waitsOn: Array<{ relation: TaskRelation; task?: Task }>;
  blocks: Array<{ relation: TaskRelation; task?: Task }>;
  related: Array<{ relation: TaskRelation; task?: Task }>;
  legacyDependsOn?: string;
  relationDraft: TaskRelationshipDraft;
  relationTargetOptions: Array<{ value: string; label: string }>;
  allowedRelationTypes: TaskRelationType[];
  pending: boolean;
  error?: string;
  onOpenTask: (taskId: string) => void;
  onRemoveRelation: (relation: TaskRelation) => void;
  canRemoveRelation: (relation: TaskRelation) => boolean;
  onRelationDraftChange: (patch: Partial<TaskRelationshipDraft>) => void;
  onAddRelation: () => void;
};

export function TaskRelationshipsSection({
  task,
  waitsOn,
  blocks,
  related,
  legacyDependsOn = "",
  relationDraft,
  relationTargetOptions,
  allowedRelationTypes,
  pending,
  error = "",
  onOpenTask,
  onRemoveRelation,
  canRemoveRelation,
  onRelationDraftChange,
  onAddRelation,
}: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const relationshipRows = [...waitsOn, ...blocks, ...related];
  const duplicateRelation = Boolean(relationDraft.relatedTaskId) && relationshipRows.some(({ relation }) => relationMatchesDraft(task.id, relation, relationDraft));
  const canAdd = allowedRelationTypes.length > 0;

  return (
    <section aria-labelledby="task-relationships-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="task-relationships-heading" className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <GitBranch size={18} className="text-blue-600" aria-hidden="true" />
            Beziehungen
          </h2>
          <p className="mt-1 text-sm text-slate-500">Abhängigkeiten und ihre Richtung im Arbeitsablauf.</p>
        </div>
        {canAdd && !formOpen ? (
          <UiButton size="lg" className="h-11" onClick={() => setFormOpen(true)} aria-expanded="false" aria-controls="task-relationship-form">
            <Plus size={15} aria-hidden="true" />
            Beziehung hinzufügen
          </UiButton>
        ) : null}
      </div>

      {waitsOn.length > 0 && blocks.length > 0 ? (
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-3 text-sm font-medium text-blue-900">
          Position in der Kette: blockiert und blockierend
        </div>
      ) : null}

      {error ? <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}

      <div className="mt-4 grid gap-4">
        {waitsOn.length ? <RelationshipList title="Wartet auf" currentTask={task} rows={waitsOn} empty="" canRemove={canRemoveRelation} onRemove={onRemoveRelation} onOpenTask={onOpenTask} /> : null}
        {blocks.length ? <RelationshipList title="Andere warten hierauf" currentTask={task} rows={blocks} empty="" canRemove={canRemoveRelation} onRemove={onRemoveRelation} onOpenTask={onOpenTask} /> : null}
        {related.length ? <RelationshipList title="Verknüpft mit" currentTask={task} rows={related} empty="" canRemove={canRemoveRelation} onRemove={onRemoveRelation} onOpenTask={onOpenTask} /> : null}
        {!relationshipRows.length ? <UiEmptyState tone="muted">Keine Beziehungen vorhanden.</UiEmptyState> : null}
      </div>

      {legacyDependsOn.trim() ? (
        <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          <span className="font-semibold">Bestehender Abhängigkeitshinweis:</span> {legacyDependsOn}
        </div>
      ) : null}

      {canAdd && formOpen ? (
        <div id="task-relationship-form" className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <TaskRelationshipForm
            relationDraft={relationDraft}
            relationTargetOptions={relationTargetOptions}
            allowedRelationTypes={allowedRelationTypes}
            duplicateRelation={duplicateRelation}
            pending={pending}
            className="grid gap-3"
            onRelationDraftChange={onRelationDraftChange}
            onAddRelation={() => {
              onAddRelation();
              setFormOpen(false);
            }}
          />
          <UiButton type="button" size="lg" className="mt-3 h-11" disabled={pending} onClick={() => setFormOpen(false)}>
            <X size={15} aria-hidden="true" />
            Abbrechen
          </UiButton>
        </div>
      ) : null}
    </section>
  );
}
