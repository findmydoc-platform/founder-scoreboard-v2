"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { Task, TaskFocusItem } from "@/lib/types";

type UseExecutionCommandsOptions = PlanningCommandContext & {
  currentProfileFocusItems: TaskFocusItem[];
  todayFocusDate: string;
};

export function useExecutionCommands({
  apiClient,
  currentProfile,
  currentProfileFocusItems,
  data,
  setData,
  setSaveError,
  source,
  startTransition,
  todayFocusDate,
}: UseExecutionCommandsOptions) {
  const upsertFocusItem = (task: Task, nextStep: string, status: TaskFocusItem["status"] = "planned") => {
    setSaveError("");
    if (!currentProfile) {
      setSaveError("Profil konnte nicht bestimmt werden. Bitte erneut anmelden.");
      return;
    }
    const profileId = currentProfile.id;
    const existing = data.taskFocusItems.find((item) => item.profileId === profileId && item.taskId === task.id && item.focusDate === todayFocusDate);
    const position = existing?.position || Math.min(currentProfileFocusItems.length + 1, 3);
    const localItem: TaskFocusItem = {
      id: existing?.id || -Date.now(),
      profileId,
      taskId: task.id,
      focusDate: todayFocusDate,
      position,
      nextStep,
      status,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setData((current) => ({
      ...current,
      taskFocusItems: existing
        ? current.taskFocusItems.map((item) => (item.id === existing.id ? localItem : item))
        : [localItem, ...current.taskFocusItems],
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.saveFocusItemRequest(apiClient, { taskId: task.id, profileId, focusDate: todayFocusDate, position, nextStep, status });
        if (!response.ok || !body?.focusItem) throw new Error(body?.error || "Fokus konnte nicht gespeichert werden.");
        setData((current) => ({
          ...current,
          taskFocusItems: current.taskFocusItems.map((item) => (item.id === localItem.id ? body.focusItem! : item)),
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          taskFocusItems: existing ? current.taskFocusItems.map((item) => (item.id === existing.id ? existing : item)) : current.taskFocusItems.filter((item) => item.id !== localItem.id),
        }));
        setSaveError(error instanceof Error ? error.message : "Fokus konnte nicht gespeichert werden.");
      }
    });
  };

  const removeFocusItem = (focusItem: TaskFocusItem) => {
    setSaveError("");
    setData((current) => ({
      ...current,
      taskFocusItems: current.taskFocusItems.filter((item) => item.id !== focusItem.id),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.deleteFocusItemRequest(apiClient, focusItem.id);
        if (!response.ok) throw new Error(body?.error || "Fokus konnte nicht entfernt werden.");
      } catch (error) {
        setData((current) => ({ ...current, taskFocusItems: [focusItem, ...current.taskFocusItems] }));
        setSaveError(error instanceof Error ? error.message : "Fokus konnte nicht entfernt werden.");
      }
    });
  };

  return {
    removeFocusItem,
    upsertFocusItem,
  };
}
