"use client";

import { useState } from "react";
import type { SprintPlanningOptions } from "@/features/settings/molecules/settings-sprint-planning";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { futureSprintDrafts, mapScoreObjectionResponse } from "@/features/planning/model/planning-app-model";
import type { ScoreObjection, Sprint, SprintCommitment } from "@/lib/types";

type UseSprintCommandsOptions = PlanningCommandContext & {
  refreshPlanningData: () => Promise<void>;
  sprintPlanningOptions: SprintPlanningOptions;
};

export function useSprintCommands({
  apiClient,
  currentProfile,
  data,
  refreshPlanningData,
  setData,
  setSaveError,
  source,
  sprintPlanningOptions,
  startTransition,
}: UseSprintCommandsOptions) {
  const [sprintLockMessage, setSprintLockMessage] = useState("");

  const updateSprint = (sprint: Sprint, patch: Partial<Sprint>) => {
    setSaveError("");

    setData((current) => ({
      ...current,
      sprints: current.sprints.map((item) => (item.id === sprint.id ? { ...item, ...patch } : item)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.updateSprintRequest(apiClient, sprint.id, {
          name: patch.name,
          status: patch.status,
          startDate: patch.startDate,
          endDate: patch.endDate,
          reviewDueAt: patch.reviewDueAt,
        });

        if (!response.ok) {
          throw new Error(body?.error || "Sprint konnte nicht gespeichert werden.");
        }

        if (body?.sprint) {
          const savedSprint = body.sprint;
          setData((current) => ({
            ...current,
            sprints: current.sprints.map((item) => (item.id === sprint.id ? savedSprint : item)),
          }));
        }
      } catch (error) {
        setData((current) => ({
          ...current,
          sprints: current.sprints.map((item) => (item.id === sprint.id ? sprint : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Sprint konnte nicht gespeichert werden.");
      }
    });
  };

  const createSprintPlanAsync = async (options: SprintPlanningOptions, silent = false) => {
    const protectedSprintIds = new Set(data.tasks.filter((task) => task.sprintId).map((task) => task.sprintId));
    const drafts = futureSprintDrafts(data.sprints, options, protectedSprintIds);
    if (!drafts.length) {
      if (!silent) setSprintLockMessage("Die Sprint-Zeiträume entsprechen bereits der aktuellen Logik. Sprints mit Aufgabenbezug werden nicht automatisch umgeplant.");
      return 0;
    }

    const draftIds = new Set(drafts.map((sprint) => sprint.id));
    setData((current) => ({
      ...current,
      sprints: [
        ...current.sprints.filter((sprint) => !draftIds.has(sprint.id)),
        ...drafts,
      ].sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "")),
    }));

    if (source !== "supabase") {
      if (!silent) setSprintLockMessage(`${drafts.length} Sprint${drafts.length === 1 ? "" : "s"} lokal aktualisiert.`);
      return drafts.length;
    }

    try {
      const { response, body } = await planningApi.createSprintPlanRequest(apiClient, options);
      if (!response.ok) throw new Error(body?.error || "Sprints konnten nicht angelegt werden.");

      if (body?.sprints) {
        setData((current) => ({
          ...current,
          sprints: [
            ...current.sprints.filter((sprint) => !draftIds.has(sprint.id)),
            ...body.sprints!,
          ].sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "")),
        }));
      }

      if (!silent) setSprintLockMessage(`${body?.sprints?.length || drafts.length} Sprint${(body?.sprints?.length || drafts.length) === 1 ? "" : "s"} aktualisiert. Sprints mit Aufgabenbezug bleiben geschützt.`);
      return body?.sprints?.length || drafts.length;
    } catch (error) {
      setData((current) => ({
        ...current,
        sprints: current.sprints.filter((sprint) => !draftIds.has(sprint.id)),
      }));
      setSaveError(error instanceof Error ? error.message : "Sprints konnten nicht angelegt werden.");
      return 0;
    }
  };

  const createSprintPlan = (options: SprintPlanningOptions) => {
    setSaveError("");
    setSprintLockMessage("");
    startTransition(async () => {
      await createSprintPlanAsync(options);
    });
  };

  const updateSprintCommitment = (commitment: SprintCommitment) => {
    setSaveError("");

    setData((current) => {
      const exists = current.sprintCommitments.some((item) => item.sprintId === commitment.sprintId && item.profileId === commitment.profileId);
      return {
        ...current,
        sprintCommitments: exists
          ? current.sprintCommitments.map((item) => (item.sprintId === commitment.sprintId && item.profileId === commitment.profileId ? commitment : item))
          : [commitment, ...current.sprintCommitments],
      };
    });

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.updateSprintCommitmentRequest(apiClient, commitment);
        if (!response.ok || !body?.commitment) throw new Error(body?.error || "Commitment konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          sprintCommitments: current.sprintCommitments.map((item) =>
            item.sprintId === commitment.sprintId && item.profileId === commitment.profileId ? body.commitment! : item,
          ),
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Commitment konnte nicht gespeichert werden.");
      }
    });
  };

  const createScoreObjection = (sprint: Sprint, comment: string) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }
    setSaveError("");

    const localObjection: ScoreObjection = {
      id: Date.now(),
      sprintId: sprint.id,
      profileId: currentProfile.id,
      founderSprintScoreId: null,
      status: "open",
      comment,
      resolutionComment: "",
      reviewedBy: "",
      reviewedAt: "",
      secondReviewerProfileId: "",
      secondReviewDecision: "",
      secondReviewedAt: "",
      createdAt: new Date().toISOString(),
    };
    const previousData = data;
    setData((current) => ({ ...current, scoreObjections: [localObjection, ...current.scoreObjections] }));

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.createScoreObjectionRequest(apiClient, sprint.id, comment);
        if (!response.ok || !body?.objection) throw new Error(body?.error || "Score-Einwand konnte nicht gespeichert werden.");
        const saved = mapScoreObjectionResponse(body.objection);
        setData((current) => ({
          ...current,
          scoreObjections: current.scoreObjections.map((item) => (item.id === localObjection.id ? saved : item)),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Score-Einwand konnte nicht gespeichert werden.");
      }
    });
  };

  const reviewScoreObjection = (sprint: Sprint, objectionId: number, status: "reviewed" | "dismissed" | "accepted") => {
    setSaveError("");
    const previousData = data;
    setData((current) => ({
      ...current,
      scoreObjections: current.scoreObjections.map((item) => (item.id === objectionId ? { ...item, status, reviewedBy: currentProfile?.id || "", reviewedAt: new Date().toISOString() } : item)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.reviewScoreObjectionRequest(apiClient, sprint.id, objectionId, status);
        if (!response.ok || !body?.objection) throw new Error(body?.error || "Score-Einwand konnte nicht geprüft werden.");
        const saved = mapScoreObjectionResponse(body.objection);
        setData((current) => ({
          ...current,
          scoreObjections: current.scoreObjections.map((item) => (item.id === saved.id ? saved : item)),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Score-Einwand konnte nicht geprüft werden.");
      }
    });
  };

  const lockSprint = (sprintId: string) => {
    setSaveError("");
    setSprintLockMessage("");

    const previousData = data;
    setData((current) => ({
      ...current,
      sprints: current.sprints.map((sprint) => (sprint.id === sprintId ? { ...sprint, status: "closed", scoreLocked: true } : sprint)),
      tasks: current.tasks.map((task) => (task.sprintId === sprintId && !task.scoreFinal ? { ...task, scorePoints: 0, scoreFinal: true } : task)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.lockSprintRequest(apiClient, sprintId);
        if (!response.ok) throw new Error(body?.error || "Sprint konnte nicht gelockt werden.");
        if (body?.carryover) {
          setSprintLockMessage(`${body.carryover.evaluated || 0} offene Deliverables bewertet, ${body.carryover.created || 0} Carry-over-Aufgaben erstellt. ${body.scoring?.scores || 0} FounderOps-Scores finalisiert, ${body.scoring?.strikeEvents || 0} Strike-Ereignisse geschrieben${body.scoring?.governanceReviews ? `, ${body.scoring.governanceReviews} Governance Review nötig` : ""}.`);
        }
        await refreshPlanningData();
        await createSprintPlanAsync(sprintPlanningOptions, true);
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Sprint konnte nicht gelockt werden.");
      }
    });
  };

  return {
    createScoreObjection,
    createSprintPlan,
    lockSprint,
    reviewScoreObjection,
    sprintLockMessage,
    updateSprint,
    updateSprintCommitment,
  };
}
