"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { mapScoreObjectionResponse } from "@/features/planning/model/planning-app-model";
import { mapFounderSprintScore } from "@/lib/planning-sprint-mappers";
import type { ScoreObjection, ScoreObjectionResolutionInput, Sprint } from "@/lib/types";

type UseSprintCommandsOptions = PlanningCommandContext;

export function useSprintCommands({
  apiClient,
  currentProfile,
  data,
  setData,
  setSaveError,
  source,
  startTransition,
}: UseSprintCommandsOptions) {
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
      resolvedDeliveryPoints: null,
      resolvedFormPoints: null,
      resolvedWeeklyPoints: null,
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

  const reviewScoreObjection = (sprint: Sprint, objectionId: number, input: ScoreObjectionResolutionInput) => {
    setSaveError("");

    if (source !== "supabase") {
      if (!currentProfile) {
        setSaveError("Teamprofil ist für die Einwand-Entscheidung erforderlich.");
        return;
      }
      const now = new Date().toISOString();
      setData((current) => {
        const objection = current.scoreObjections.find((item) => item.id === objectionId);
        if (!objection) return current;
        const accepted = input.action === "resolve" && input.status === "accepted";
        const deliveryPoints = accepted ? input.deliveryPoints ?? 0 : null;
        const formPoints = accepted ? input.formPoints ?? 0 : null;
        const weeklyPoints = accepted ? input.weeklyPoints ?? 0 : null;
        const totalPoints = (deliveryPoints || 0) + (formPoints || 0) + (weeklyPoints || 0);
        const existingScore = current.founderSprintScores.find((item) => item.sprintId === sprint.id && item.profileId === objection.profileId);
        const correctedScore = accepted ? {
          id: existingScore?.id || Date.now(),
          sprintId: sprint.id,
          profileId: objection.profileId,
          deliveryPoints: deliveryPoints || 0,
          formPoints: formPoints || 0,
          weeklyPoints: weeklyPoints || 0,
          totalPoints,
          fulfilled: totalPoints >= 12,
          awayNeutral: false,
          finalizedAt: now,
          finalizedBy: currentProfile.id,
          reasonSummary: `Korrigiert nach angenommenem Score-Einwand #${objectionId}.`,
        } : null;
        return {
          ...current,
          scoreObjections: current.scoreObjections.map((item) => {
            if (item.id !== objectionId) return item;
            if (input.action === "assign_second_review") return {
              ...item,
              secondReviewerProfileId: input.secondReviewerProfileId || "",
              secondReviewDecision: "",
              secondReviewedAt: "",
            };
            if (input.action === "second_review") return {
              ...item,
              secondReviewDecision: input.secondReviewDecision || "",
              secondReviewedAt: now,
            };
            return {
              ...item,
              status: input.status || "reviewed",
              resolutionComment: input.resolutionComment || "",
              reviewedBy: currentProfile.id,
              reviewedAt: now,
              resolvedDeliveryPoints: deliveryPoints,
              resolvedFormPoints: formPoints,
              resolvedWeeklyPoints: weeklyPoints,
              founderSprintScoreId: correctedScore?.id || item.founderSprintScoreId,
            };
          }),
          founderSprintScores: correctedScore
            ? existingScore
              ? current.founderSprintScores.map((item) => item.id === existingScore.id ? correctedScore : item)
              : [correctedScore, ...current.founderSprintScores]
            : current.founderSprintScores,
        };
      });
      return;
    }

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.reviewScoreObjectionRequest(apiClient, sprint.id, objectionId, input);
        if (!response.ok || !body?.objection) throw new Error(body?.error || "Score-Einwand konnte nicht geprüft werden.");
        const saved = mapScoreObjectionResponse(body.objection);
        const savedScore = body.score ? mapFounderSprintScore(body.score) : null;
        setData((current) => ({
          ...current,
          scoreObjections: current.scoreObjections.map((item) => (item.id === saved.id ? saved : item)),
          founderSprintScores: savedScore
            ? current.founderSprintScores.some((item) => item.sprintId === savedScore.sprintId && item.profileId === savedScore.profileId)
              ? current.founderSprintScores.map((item) => item.sprintId === savedScore.sprintId && item.profileId === savedScore.profileId ? savedScore : item)
              : [savedScore, ...current.founderSprintScores]
            : current.founderSprintScores,
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Score-Einwand konnte nicht geprüft werden.");
      }
    });
  };

  return {
    createScoreObjection,
    reviewScoreObjection,
  };
}
