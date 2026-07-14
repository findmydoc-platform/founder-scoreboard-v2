"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { persistLocalPlanningData } from "@/features/planning/hooks/use-local-planning-state";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { milestoneNotEmptyMessage } from "@/features/projects/model/milestone-policy";
import type { MilestoneDeleteTarget } from "@/features/projects/organisms/milestone-delete-dialog";
import type { MilestoneDraft } from "@/features/projects/organisms/milestone-dialog";
import type { Milestone, PlanningData } from "@/lib/types";

type UseMilestoneCommandsOptions = PlanningCommandContext & {
  setMilestoneDeleteTarget: Dispatch<SetStateAction<MilestoneDeleteTarget | null>>;
  setMilestoneDialogDefaults: Dispatch<SetStateAction<Partial<MilestoneDraft> | null>>;
};

function responseError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

function localMilestoneId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `local-milestone-${crypto.randomUUID()}`
    : `local-milestone-${Date.now()}`;
}

export function useMilestoneCommands({
  apiClient,
  applyPlanningDataUpdate,
  data,
  setData,
  setMilestoneDeleteTarget,
  setMilestoneDialogDefaults,
  source,
}: UseMilestoneCommandsOptions) {
  const applySeedUpdate = (updater: (current: PlanningData) => PlanningData) => {
    setData((current) => {
      const nextData = updater(current);
      persistLocalPlanningData(nextData);
      return nextData;
    });
  };

  const saveMilestone = async (draft: MilestoneDraft) => {
    const existing = draft.id ? data.milestones.find((milestone) => milestone.id === draft.id) : undefined;

    if (source === "seed") {
      const milestone: Milestone = {
        id: existing?.id || localMilestoneId(),
        title: draft.title.trim(),
        description: draft.description.trim(),
        targetDate: draft.targetDate,
        status: draft.status,
        sortOrder: existing?.sortOrder ?? Math.max(0, ...data.milestones.map((item) => item.sortOrder)) + 1,
        updatedAt: "",
      };
      applySeedUpdate((current) => ({
        ...current,
        milestones: existing
          ? current.milestones.map((item) => item.id === milestone.id ? milestone : item)
          : [...current.milestones, milestone],
      }));
      setMilestoneDialogDefaults(null);
      return;
    }

    const { response, body } = await planningApi.saveMilestoneRequest(apiClient, draft);
    if (!response.ok || !body || !("milestone" in body)) {
      throw new Error(responseError(body, "Der Meilenstein konnte nicht gespeichert werden."));
    }
    applyPlanningDataUpdate((current) => ({
      ...current,
      milestones: existing
        ? current.milestones.map((item) => item.id === body.milestone.id ? body.milestone : item)
        : [...current.milestones, body.milestone],
    }));
    setMilestoneDialogDefaults(null);
  };

  const deleteMilestone = async (milestone: Milestone) => {
    if (source === "seed") {
      const children = {
        initiatives: data.packages.filter((initiative) => initiative.milestoneId === milestone.id).length,
        tasks: data.tasks.filter((task) => task.milestoneId === milestone.id).length,
      };
      if (children.initiatives || children.tasks) throw new Error(milestoneNotEmptyMessage(children));
      applySeedUpdate((current) => ({
        ...current,
        milestones: current.milestones.filter((item) => item.id !== milestone.id),
      }));
      setMilestoneDeleteTarget(null);
      return;
    }

    const { response, body } = await planningApi.deleteMilestoneRequest(apiClient, milestone.id, {
      expectedUpdatedAt: milestone.updatedAt,
    });
    if (!response.ok) throw new Error(responseError(body, "Der Meilenstein konnte nicht gelöscht werden."));
    applyPlanningDataUpdate((current) => ({
      ...current,
      milestones: current.milestones.filter((item) => item.id !== milestone.id),
    }));
    setMilestoneDeleteTarget(null);
  };

  return { deleteMilestone, saveMilestone };
}
