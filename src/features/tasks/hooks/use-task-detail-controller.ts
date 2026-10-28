"use client";

import type { PlanningTaskEditor } from "@/features/planning/model/planning-state";
import type { TaskUpdateOptions } from "@/features/tasks/hooks/task-mutation-command-types";

import { validatePlanningFields } from "@/features/planning-items/model/planning-item-content";

import { useEffect, useMemo, useState } from "react";
import type { TaskRelationshipDraft } from "@/features/tasks/molecules/task-relationship-form";
import {
  buildTaskOverviewDraft,
  taskOverviewIsDirty,
  taskOverviewPatch,
  type TaskOverviewDraft,
} from "@/features/tasks/model/task-detail-presentation";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";
import type { AuthenticatedProfile, Profile, Task } from "@/lib/types";

type TaskDetailProfile = Pick<AuthenticatedProfile, "id" | "name" | "platformRole"> | Pick<Profile, "id" | "name" | "platformRole">;

export function useTaskDetailController({
  task,
  currentProfile,
  unrestricted = false,
  operationalCorrection = false,
  onUpdate,
  onBeginEdit,
  onOverviewDirtyChange,
}: {
  task: Task;
  currentProfile?: TaskDetailProfile | null;
  unrestricted?: boolean;
  operationalCorrection?: boolean;
  onBeginEdit?: () => PlanningTaskEditor;
  onUpdate: (patch: Partial<Task>, options?: TaskUpdateOptions) => Promise<TaskUpdateResult> | void;
  onOverviewDirtyChange?: (dirty: boolean) => void;
}) {
  const [overviewEditing, setOverviewEditing] = useState(false);
  const [overviewBaseline, setOverviewBaseline] = useState<Task>(() => task);
  const [overviewDraft, setOverviewDraft] = useState<TaskOverviewDraft>(() => buildTaskOverviewDraft(task));
  const [overviewEditor, setOverviewEditor] = useState<PlanningTaskEditor | null>(null);
  const [overviewConflict, setOverviewConflict] = useState(false);
  const [overviewSaving, setOverviewSaving] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [blockerDraft, setBlockerDraft] = useState({ reason: "", impact: "", needsHelpFrom: "" });
  const [relationDraft, setRelationDraft] = useState<TaskRelationshipDraft>({ relationType: "blocked_by", relatedTaskId: "", note: "" });
  const permissions = taskDetailPermissions({ task, profile: currentProfile, unrestricted, operationalCorrection });
  const overviewPermissions = useMemo(() => ({
    canEditBrief: permissions.canEditBrief,
    canEditChecklist: permissions.canEditChecklist,
    canEditEvidence: permissions.canEditEvidence,
    canEditNotes: permissions.canEditNotes,
  }), [permissions.canEditBrief, permissions.canEditChecklist, permissions.canEditEvidence, permissions.canEditNotes]);
  useEffect(() => () => overviewEditor?.close(), [overviewEditor]);
  const overviewDirty = overviewEditing && taskOverviewIsDirty(overviewBaseline, overviewDraft, overviewPermissions);

  useEffect(() => {
    onOverviewDirtyChange?.(overviewDirty);
    return () => onOverviewDirtyChange?.(false);
  }, [onOverviewDirtyChange, overviewDirty]);

  const cancelOverview = () => {
    overviewEditor?.close();
    setOverviewEditor(null);
    setOverviewConflict(false);
    setOverviewDraft(buildTaskOverviewDraft(task));
    setOverviewError("");
    setOverviewEditing(false);
  };

  const startOverviewEditing = () => {
    overviewEditor?.close();
    setOverviewEditor(onBeginEdit?.() || null);
    setOverviewConflict(false);
    setOverviewBaseline(task);
    setOverviewDraft(buildTaskOverviewDraft(task));
    setOverviewError("");
    setOverviewEditing(true);
  };

  const saveOverview = async (resave = false) => {
    if (!overviewDirty || overviewSaving) return false;
    const patch = taskOverviewPatch(overviewBaseline, overviewDraft, overviewPermissions);
    if (!Object.keys(patch).length) return false;

    const resultingTask = { ...overviewBaseline, ...patch };
    const lengthErrors = validatePlanningFields(resultingTask.taskType === "initiative" ? {
      ...resultingTask, intendedOutcome: overviewDraft.strategyGoal,
      acceptanceCriteria: overviewDraft.strategySuccessCriteria, scopeConstraints: overviewDraft.strategyScopeConstraints,
    } : resultingTask);
    if (lengthErrors.length) { setOverviewError(lengthErrors[0].message); return false; }
    setOverviewSaving(true);
    setOverviewError("");
    try {
      const result = await (overviewEditor ? onUpdate(patch, { editor: overviewEditor, resave }) : onUpdate(patch));
      if (result && !result.ok) {
        setOverviewConflict(result.kind === "versionConflict");
        setOverviewError(result.error || "Änderungen konnten nicht gespeichert werden.");
        return false;
      }
      overviewEditor?.close();
      setOverviewEditor(null);
      setOverviewConflict(false);
      setOverviewEditing(false);
      return true;
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : "Änderungen konnten nicht gespeichert werden.");
      return false;
    } finally {
      setOverviewSaving(false);
    }
  };

  return {
    blockerDraft,
    cancelOverview,
    overviewConflict,
    overviewCanResave: overviewEditor?.view().canResave || false,
    overviewServerDraft: overviewEditor?.view().serverTask ? buildTaskOverviewDraft(overviewEditor.view().serverTask!) : null,
    refreshOverviewConflict: async () => { await overviewEditor?.refreshConflict(); },
    resaveOverview: () => saveOverview(true),
    overviewBaselineDraft: buildTaskOverviewDraft(overviewBaseline),
    overviewDraft: overviewEditing ? overviewDraft : buildTaskOverviewDraft(task),
    overviewDirty,
    overviewEditing,
    overviewError,
    overviewPermissions,
    overviewSaving,
    permissions,
    relationDraft,
    saveOverview,
    setBlockerDraft,
    setOverviewDraft,
    setRelationDraft,
    startOverviewEditing,
  };
}
