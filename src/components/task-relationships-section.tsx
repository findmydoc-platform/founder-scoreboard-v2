"use client";

import { CircleHelp, X } from "lucide-react";
import { CustomSelect } from "@/components/custom-select";
import { relationshipHelpText, relationTypeLabel, taskOwnerLabel } from "@/lib/display";
import { relationshipBadgeFor, relationshipBadgeToneClass, relationMatchesDraft } from "@/lib/relationship-view-model";
import { normalizeStatus } from "@/lib/status";
import type { Task, TaskRelation, TaskRelationType } from "@/lib/types";

export type TaskRelationshipDraft = {
  relationType: TaskRelationType;
  relatedTaskId: string;
  note: string;
};

function RelationshipInfo({ title }: { title: string }) {
  const description = relationshipHelpText(title);
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        title={description}
        aria-label={`${title}: ${description}`}
        className="grid h-5 w-5 cursor-help place-items-center rounded-full border border-slate-200 bg-white text-slate-400 outline-none transition hover:border-blue-200 hover:text-blue-600 focus:border-blue-300 focus:text-blue-700"
      >
        <CircleHelp size={13} />
      </span>
      <span className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-64 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-5 text-slate-700 shadow-lg group-hover:block group-focus-within:block">
        {description}
      </span>
    </span>
  );
}

function RelationshipPanelList({
  title,
  currentTask,
  rows,
  empty,
  canManage,
  onRemove,
}: {
  title: string;
  currentTask: Task;
  rows: Array<{ relation: TaskRelation; task?: Task }>;
  empty: string;
  canManage?: boolean;
  onRemove?: (relation: TaskRelation) => void;
}) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          {title}
          <RelationshipInfo title={title} />
        </span>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">{rows.length}</span>
      </div>
      <div className="mt-2 grid gap-1.5">
        {rows.map(({ relation, task }) => {
          const badge = relationshipBadgeFor(currentTask, relation, task);

          return (
            <div key={`${relation.id}-${task?.id || "unknown"}`} className="flex items-start justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-xs">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="break-words font-semibold text-slate-800">{task?.title || relation.relatedTaskId}</span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${relationshipBadgeToneClass(badge.tone)}`}>
                    {badge.label}
                  </span>
                </div>
                <div className="mt-0.5 text-slate-500">{task ? `${normalizeStatus(task.status)} · ${taskOwnerLabel(task)}` : "Aufgabe nicht gefunden"}</div>
                {relation.note && <div className="mt-1 break-words text-slate-500">{relation.note}</div>}
              </div>
              {canManage && onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(relation)}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  aria-label={`${title}-Relationship entfernen`}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          );
        })}
        {!rows.length && <div className="text-xs text-slate-500">{empty}</div>}
      </div>
    </div>
  );
}

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
        <RelationshipPanelList title="Wartet auf" currentTask={task} rows={waitsOn} empty="Wartet auf keine andere Aufgabe." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
        <RelationshipPanelList title="Blockiert" currentTask={task} rows={blocks} empty="Blockiert keine andere Aufgabe." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
        <RelationshipPanelList title="Verknüpft mit" currentTask={task} rows={related} empty="Keine losen Verknüpfungen." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
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
          <input
            value={relationDraft.note}
            onChange={(event) => onRelationDraftChange({ note: event.target.value })}
            className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
            placeholder="Optionaler Hinweis"
          />
          <button
            type="button"
            disabled={pending || !relationDraft.relatedTaskId || duplicateRelation}
            onClick={onAddRelation}
            className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {duplicateRelation ? "Relationship existiert bereits" : "Relationship hinzufügen"}
          </button>
          {duplicateRelation && <div className="text-xs font-semibold text-amber-700">Diese Relationship ist bereits gespeichert.</div>}
        </div>
      )}
    </div>
  );
}
