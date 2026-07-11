"use client";

import { useState } from "react";
import type { TaskRelationshipDraft } from "@/features/tasks/molecules/task-relationship-form";
import { buildTaskBriefDraft, type TaskBriefDraft } from "@/features/tasks/model/task-detail-state";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";
import type { AuthenticatedProfile, Profile, Task } from "@/lib/types";

type TaskDetailProfile = Pick<AuthenticatedProfile, "id" | "name" | "platformRole"> | Pick<Profile, "id" | "name" | "platformRole">;

export function useTaskDetailController({
  task,
  currentProfile,
  unrestricted = false,
  onUpdate,
}: {
  task: Task;
  currentProfile?: TaskDetailProfile | null;
  unrestricted?: boolean;
  onUpdate: (patch: Partial<Task>) => void;
}) {
  const [briefEditing, setBriefEditing] = useState(false);
  const [briefDraft, setBriefDraft] = useState<TaskBriefDraft>(() => buildTaskBriefDraft(task));
  const [evidenceDraft, setEvidenceDraft] = useState(task.evidenceLink || "");
  const [evidenceDirty, setEvidenceDirty] = useState(false);
  const [dependsOnDraft, setDependsOnDraft] = useState(task.dependsOn || "");
  const [dependsOnDirty, setDependsOnDirty] = useState(false);
  const [noteDraft, setNoteDraft] = useState(task.note || "");
  const [noteDirty, setNoteDirty] = useState(false);
  const [blockerDraft, setBlockerDraft] = useState({ reason: "", impact: "", needsHelpFrom: "" });
  const [relationDraft, setRelationDraft] = useState<TaskRelationshipDraft>({ relationType: "blocked_by", relatedTaskId: "", note: "" });
  const permissions = taskDetailPermissions({ task, profile: currentProfile, unrestricted });

  const cancelBrief = () => {
    setBriefDraft(buildTaskBriefDraft(task));
    setBriefEditing(false);
  };

  const startBriefEditing = () => {
    setBriefDraft(buildTaskBriefDraft(task));
    setBriefEditing(true);
  };

  const saveBrief = () => {
    if (!permissions.canEditBrief) return;
    onUpdate(briefDraft);
    setBriefEditing(false);
  };

  const saveEvidence = () => {
    if (!permissions.canEditEvidence || !evidenceDirty) return;
    onUpdate({ evidenceLink: evidenceDraft });
    setEvidenceDirty(false);
  };

  const saveNote = () => {
    if (!permissions.canEditNotes || !noteDirty) return;
    onUpdate({ note: noteDraft });
    setNoteDirty(false);
  };

  const saveDependsOn = () => {
    if (!permissions.canEditNotes || !dependsOnDirty) return;
    onUpdate({ dependsOn: dependsOnDraft });
    setDependsOnDirty(false);
  };

  return {
    blockerDraft,
    briefDraft: briefEditing ? briefDraft : buildTaskBriefDraft(task),
    briefEditing,
    cancelBrief,
    dependsOnDraft: dependsOnDirty ? dependsOnDraft : task.dependsOn || "",
    evidenceDraft: evidenceDirty ? evidenceDraft : task.evidenceLink || "",
    noteDraft: noteDirty ? noteDraft : task.note || "",
    permissions,
    relationDraft,
    saveBrief,
    saveDependsOn,
    saveEvidence,
    saveNote,
    setBriefDraft,
    startBriefEditing,
    setBlockerDraft,
    setEvidenceDraft: (value: string) => {
      setEvidenceDraft(value);
      setEvidenceDirty(true);
    },
    setDependsOnDraft: (value: string) => {
      setDependsOnDraft(value);
      setDependsOnDirty(true);
    },
    setNoteDraft: (value: string) => {
      setNoteDraft(value);
      setNoteDirty(true);
    },
    setRelationDraft,
  };
}
