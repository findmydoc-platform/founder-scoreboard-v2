"use client";

import { useState, type TransitionStartFunction } from "react";
import type { TaskRelationshipDraft } from "@/features/tasks/organisms/task-relationships-section";
import { addTaskRelationshipRequest, removeTaskRelationshipRequest } from "@/features/tasks/model/task-api-client";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Task, TaskRelation } from "@/lib/types";

export function useTaskRelationships({
  task,
  initialRelations,
  apiClient,
  source,
  startTransition,
  setError,
}: {
  task: Task;
  initialRelations: TaskRelation[];
  apiClient: BrowserApiClient;
  source: "seed" | "supabase";
  startTransition: TransitionStartFunction;
  setError: (message: string) => void;
}) {
  const [relations, setRelations] = useState(initialRelations);
  const [relationDraft, setRelationDraft] = useState<TaskRelationshipDraft>({
    relationType: "blocked_by",
    relatedTaskId: "",
    note: "",
  });

  const addRelation = () => {
    if (!relationDraft.relatedTaskId || relationDraft.relatedTaskId === task.id) return;

    const localRelation: TaskRelation = {
      id: Date.now(),
      taskId: task.id,
      relatedTaskId: relationDraft.relatedTaskId,
      relationType: relationDraft.relationType,
      note: relationDraft.note,
      createdBy: "",
      createdAt: new Date().toISOString(),
    };

    setRelations((current) => [localRelation, ...current]);
    setRelationDraft({ relationType: "blocked_by", relatedTaskId: "", note: "" });
    setError("");

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await addTaskRelationshipRequest(apiClient, task.id, relationDraft);
        if (!response.ok || !body?.relation) throw new Error(body?.error || "Relationship konnte nicht gespeichert werden.");
        setRelations((current) => current.map((relation) => (relation.id === localRelation.id ? body.relation! : relation)));
      } catch (caught) {
        setRelations((current) => current.filter((relation) => relation.id !== localRelation.id));
        setError(caught instanceof Error ? caught.message : "Relationship konnte nicht gespeichert werden.");
      }
    });
  };

  const removeRelation = (relation: TaskRelation) => {
    setRelations((current) => current.filter((item) => item.id !== relation.id));
    setError("");

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await removeTaskRelationshipRequest(apiClient, task.id, relation.id);
        if (!response.ok) throw new Error(body?.error || "Relationship konnte nicht entfernt werden.");
      } catch (caught) {
        setRelations((current) => [relation, ...current]);
        setError(caught instanceof Error ? caught.message : "Relationship konnte nicht entfernt werden.");
      }
    });
  };

  return {
    relations,
    relationDraft,
    setRelationDraft,
    addRelation,
    removeRelation,
  };
}
