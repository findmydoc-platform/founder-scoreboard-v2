"use client";

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
  onUpdate,
  onOverviewDirtyChange,
}: {
  task: Task;
  currentProfile?: TaskDetailProfile | null;
  unrestricted?: boolean;
  onUpdate: (patch: Partial<Task>) => Promise<TaskUpdateResult> | void;
  onOverviewDirtyChange?: (dirty: boolean) => void;
}) {
  const [overviewEditing, setOverviewEditing] = useState(false);
  const [overviewBaseline, setOverviewBaseline] = useState<Task>(() => task);
  const [overviewDraft, setOverviewDraft] = useState<TaskOverviewDraft>(() => buildTaskOverviewDraft(task));
  const [overviewSaving, setOverviewSaving] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [blockerDraft, setBlockerDraft] = useState({ reason: "", impact: "", needsHelpFrom: "" });
  const [relationDraft, setRelationDraft] = useState<TaskRelationshipDraft>({ relationType: "blocked_by", relatedTaskId: "", note: "" });
  const permissions = taskDetailPermissions({ task, profile: currentProfile, unrestricted });
  const overviewPermissions = useMemo(() => ({
    canEditBrief: permissions.canEditBrief,
    canEditChecklist: permissions.canEditChecklist,
    canEditEvidence: permissions.canEditEvidence,
    canEditNotes: permissions.canEditNotes,
  }), [permissions.canEditBrief, permissions.canEditChecklist, permissions.canEditEvidence, permissions.canEditNotes]);
  const overviewDirty = overviewEditing && taskOverviewIsDirty(overviewBaseline, overviewDraft, overviewPermissions);

  useEffect(() => {
    onOverviewDirtyChange?.(overviewDirty);
    return () => onOverviewDirtyChange?.(false);
  }, [onOverviewDirtyChange, overviewDirty]);

  const cancelOverview = () => {
    setOverviewDraft(buildTaskOverviewDraft(task));
    setOverviewError("");
    setOverviewEditing(false);
  };

  const startOverviewEditing = () => {
    setOverviewBaseline(task);
    setOverviewDraft(buildTaskOverviewDraft(task));
    setOverviewError("");
    setOverviewEditing(true);
  };

  const saveOverview = async () => {
    if (!overviewDirty || overviewSaving) return false;
    const patch = taskOverviewPatch(overviewBaseline, overviewDraft, overviewPermissions);
    if (!Object.keys(patch).length) return false;

    setOverviewSaving(true);
    setOverviewError("");
    try {
      const result = await onUpdate(patch);
      if (result && !result.ok) {
        setOverviewError(result.error || "Änderungen konnten nicht gespeichert werden.");
        return false;
      }
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
