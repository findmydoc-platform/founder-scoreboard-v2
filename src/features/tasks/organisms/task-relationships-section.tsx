"use client";

import { GitBranch, Pencil, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import type { TaskActionResult, TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";
import { RelationshipList } from "@/features/tasks/molecules/relationship-list";
import { TaskRelationshipForm, type TaskRelationshipDraft } from "@/features/tasks/molecules/task-relationship-form";
import type { TaskRelationshipRow } from "@/features/tasks/model/task-detail-state";
import { relationMatchesDraft } from "@/lib/relationship-view-model";
import type { Task, TaskRelation, TaskRelationType } from "@/lib/types";
import { UiButton, UiEmptyState, UiField, UiTextArea } from "@/shared/atoms/ui-primitives";

type Props = {
  task: Task;
  waitsOn: TaskRelationshipRow[];
  blocks: TaskRelationshipRow[];
  related: TaskRelationshipRow[];
  legacyDependsOn?: string;
  canEditLegacyDependsOn?: boolean;
  relationDraft: TaskRelationshipDraft;
  relationTargetOptions: Array<{ value: string; label: string }>;
  allowedRelationTypes: TaskRelationType[];
  pending: boolean;
  error?: string;
  loading?: boolean;
  unavailable?: boolean;
  onOpenTask: (taskId: string) => void;
  onRemoveRelation: (relation: TaskRelation) => void;
  canRemoveRelation: (relation: TaskRelation) => boolean;
  onUpdateLegacyDependsOn?: (value: string) => Promise<TaskUpdateResult>;
  onRelationDraftChange: (patch: Partial<TaskRelationshipDraft>) => void;
  onAddRelation: () => Promise<TaskActionResult>;
};

export function TaskRelationshipsSection({
  task,
  waitsOn,
  blocks,
  related,
  legacyDependsOn = "",
  canEditLegacyDependsOn = false,
  relationDraft,
  relationTargetOptions,
  allowedRelationTypes,
  pending,
  error = "",
  loading = false,
  unavailable = false,
  onOpenTask,
  onRemoveRelation,
  canRemoveRelation,
  onUpdateLegacyDependsOn,
  onRelationDraftChange,
  onAddRelation,
}: Props) {
  const generatedId = useId().replaceAll(":", "");
  const relationTriggerId = `task-relationship-trigger-${generatedId}`;
  const legacyTriggerId = `task-legacy-dependency-trigger-${generatedId}`;
  const [formOpen, setFormOpen] = useState(false);
  const [relationSubmitting, setRelationSubmitting] = useState(false);
  const [relationError, setRelationError] = useState("");
  const [legacyEditing, setLegacyEditing] = useState(false);
  const [legacyDraft, setLegacyDraft] = useState(legacyDependsOn);
  const [legacySaving, setLegacySaving] = useState(false);
  const [legacyError, setLegacyError] = useState("");
  const relationshipRows = [...waitsOn, ...blocks, ...related];
  const duplicateRelation = Boolean(relationDraft.relatedTaskId) && relationshipRows.some(({ relation }) => relationMatchesDraft(task.id, relation, relationDraft));
  const canAdd = allowedRelationTypes.length > 0;
  const canEditLegacy = canEditLegacyDependsOn && Boolean(onUpdateLegacyDependsOn);
  const relationBusy = pending || relationSubmitting;
  const relationshipDataReady = !loading && !error && !unavailable;

  const closeRelationForm = () => {
    setFormOpen(false);
    setRelationError("");
    window.requestAnimationFrame(() => document.getElementById(relationTriggerId)?.focus());
  };

  const closeLegacyEditor = () => {
    setLegacyDraft(legacyDependsOn);
    setLegacyError("");
    setLegacyEditing(false);
    window.requestAnimationFrame(() => document.getElementById(legacyTriggerId)?.focus());
  };

  const addRelation = async () => {
    if (relationBusy) return;
    setRelationSubmitting(true);
    setRelationError("");
    try {
      const result = await onAddRelation();
      if (!result.ok) {
        setRelationError(result.error);
        window.requestAnimationFrame(() => document.getElementById("task-relationship-error")?.focus());
        return;
      }
      closeRelationForm();
    } catch (caught) {
      setRelationError(caught instanceof Error ? caught.message : "Abhängigkeit konnte nicht gespeichert werden.");
      window.requestAnimationFrame(() => document.getElementById("task-relationship-error")?.focus());
    } finally {
      setRelationSubmitting(false);
    }
  };

  const saveLegacyDependsOn = async () => {
    if (!onUpdateLegacyDependsOn || legacySaving) return;
    if (legacyDraft === legacyDependsOn) {
      closeLegacyEditor();
      return;
    }
    setLegacySaving(true);
    setLegacyError("");
    try {
      const result = await onUpdateLegacyDependsOn(legacyDraft);
      if (!result.ok) {
        setLegacyError(result.error || "Abhängigkeitshinweis konnte nicht gespeichert werden.");
        return;
      }
      setLegacyEditing(false);
      window.requestAnimationFrame(() => document.getElementById(legacyTriggerId)?.focus());
    } catch (caught) {
      setLegacyError(caught instanceof Error ? caught.message : "Abhängigkeitshinweis konnte nicht gespeichert werden.");
    } finally {
      setLegacySaving(false);
    }
  };

  return (
    <section aria-labelledby="task-relationships-heading" aria-busy={loading} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="task-relationships-heading" className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <GitBranch size={18} className="text-blue-600" aria-hidden="true" />
            Beziehungen
          </h2>
          <p className="mt-1 text-sm text-slate-500">Abhängigkeiten und ihre Richtung im Arbeitsablauf.</p>
        </div>
        {canAdd && relationshipDataReady && !formOpen ? (
          <UiButton id={relationTriggerId} size="lg" className="h-11" onClick={() => { setRelationError(""); setFormOpen(true); }} aria-expanded="false" aria-controls="task-relationship-form">
            <Plus size={15} aria-hidden="true" />
            Beziehung hinzufügen
          </UiButton>
        ) : null}
      </div>

      {relationshipDataReady && waitsOn.length > 0 && blocks.length > 0 ? (
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-3 text-sm font-medium text-blue-900">
          Position in der Kette: blockiert und blockierend
        </div>
      ) : null}

      {error ? <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}

      {loading ? (
        <div className="mt-4 grid gap-3" aria-label="Beziehungen werden geladen">
          <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
        </div>
      ) : null}

      {relationshipDataReady ? (
        <div className="mt-4 grid gap-4">
          {waitsOn.length ? <RelationshipList title="Wartet auf" currentTask={task} rows={waitsOn} empty="" canRemove={canRemoveRelation} onRemove={onRemoveRelation} onOpenTask={onOpenTask} /> : null}
          {blocks.length ? <RelationshipList title="Andere warten hierauf" currentTask={task} rows={blocks} empty="" canRemove={canRemoveRelation} onRemove={onRemoveRelation} onOpenTask={onOpenTask} /> : null}
          {related.length ? <RelationshipList title="Verknüpft mit" currentTask={task} rows={related} empty="" canRemove={canRemoveRelation} onRemove={onRemoveRelation} onOpenTask={onOpenTask} /> : null}
          {!relationshipRows.length ? <UiEmptyState tone="muted">Keine Beziehungen vorhanden.</UiEmptyState> : null}
        </div>
      ) : null}

      {legacyEditing ? (
        <form
          className="mt-4 grid gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4"
          aria-busy={legacySaving}
          onSubmit={(event) => {
            event.preventDefault();
            void saveLegacyDependsOn();
          }}
        >
          <UiField>
            Bestehender Abhängigkeitshinweis
            <UiTextArea
              value={legacyDraft}
              disabled={legacySaving}
              onChange={(event) => setLegacyDraft(event.target.value)}
              className="min-h-24 w-full p-3 leading-6"
              placeholder="Freitext-Hinweis zu einer noch nicht verknüpften Abhängigkeit"
            />
          </UiField>
          {legacyError ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{legacyError}</div> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <UiButton
              type="button"
              size="lg"
              disabled={legacySaving}
              onClick={closeLegacyEditor}
            >
              Abbrechen
            </UiButton>
            <UiButton type="submit" size="lg" variant="primary" disabled={legacySaving || legacyDraft === legacyDependsOn}>
              {legacySaving ? "Speichert …" : "Speichern"}
            </UiButton>
          </div>
        </form>
      ) : legacyDependsOn.trim() ? (
        <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold">Bestehender Abhängigkeitshinweis</div>
              <p className="mt-1 whitespace-pre-wrap break-words">{legacyDependsOn}</p>
            </div>
            {canEditLegacy ? (
              <UiButton
                id={legacyTriggerId}
                type="button"
                onClick={() => {
                  setLegacyDraft(legacyDependsOn);
                  setLegacyError("");
                  setLegacyEditing(true);
                }}
              >
                <Pencil size={15} aria-hidden="true" />
                Bearbeiten
              </UiButton>
            ) : null}
          </div>
        </div>
      ) : null}

      {canAdd && relationshipDataReady && formOpen ? (
        <div id="task-relationship-form" className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <TaskRelationshipForm
            relationDraft={relationDraft}
            relationTargetOptions={relationTargetOptions}
            allowedRelationTypes={allowedRelationTypes}
            duplicateRelation={duplicateRelation}
            pending={relationBusy}
            error={relationError}
            className="grid gap-3"
            onRelationDraftChange={onRelationDraftChange}
            onAddRelation={() => void addRelation()}
          />
          <UiButton type="button" size="lg" className="mt-3 h-11" disabled={relationBusy} onClick={closeRelationForm}>
            <X size={15} aria-hidden="true" />
            Abbrechen
          </UiButton>
        </div>
      ) : null}
    </section>
  );
}
