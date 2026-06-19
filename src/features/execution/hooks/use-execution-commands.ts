"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { DecisionTaskLink, Task, TaskFocusItem } from "@/lib/types";

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

  const linkDecisionTask = (decisionId: number, taskId: string, note: string) => {
    setSaveError("");
    const localLink: DecisionTaskLink = {
      id: -Date.now(),
      decisionId,
      taskId,
      linkType: "follows_from",
      note,
      createdBy: currentProfile?.id || "",
      createdAt: new Date().toISOString(),
    };

    setData((current) => {
      const exists = current.decisionTaskLinks.some((link) => link.decisionId === decisionId && link.taskId === taskId);
      return exists ? current : { ...current, decisionTaskLinks: [localLink, ...current.decisionTaskLinks] };
    });

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.linkDecisionTaskRequest(apiClient, decisionId, { taskId, linkType: "follows_from", note });
        if (!response.ok || !body?.link) throw new Error(body?.error || "Decision-Link konnte nicht gespeichert werden.");
        setData((current) => ({
          ...current,
          decisionTaskLinks: current.decisionTaskLinks.map((link) => (link.id === localLink.id ? body.link! : link)),
        }));
      } catch (error) {
        setData((current) => ({ ...current, decisionTaskLinks: current.decisionTaskLinks.filter((link) => link.id !== localLink.id) }));
        setSaveError(error instanceof Error ? error.message : "Decision-Link konnte nicht gespeichert werden.");
      }
    });
  };

  const removeDecisionTaskLink = (link: DecisionTaskLink) => {
    setSaveError("");
    setData((current) => ({
      ...current,
      decisionTaskLinks: current.decisionTaskLinks.filter((item) => item.id !== link.id),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.deleteDecisionTaskLinkRequest(apiClient, link.decisionId, link.id);
        if (!response.ok) throw new Error(body?.error || "Decision-Link konnte nicht entfernt werden.");
      } catch (error) {
        setData((current) => ({ ...current, decisionTaskLinks: [link, ...current.decisionTaskLinks] }));
        setSaveError(error instanceof Error ? error.message : "Decision-Link konnte nicht entfernt werden.");
      }
    });
  };

  return {
    linkDecisionTask,
    removeDecisionTaskLink,
    removeFocusItem,
    upsertFocusItem,
  };
}
