"use client";

import { useState } from "react";
import type { FeedbackDraft } from "@/features/settings/molecules/feedback-dialog";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { FeedbackItem } from "@/lib/types";

type UseFeedbackCommandsOptions = PlanningCommandContext & {
  setFeedbackDialogOpen: (open: boolean) => void;
  setSelectedFeedbackId: (feedbackId: number | null) => void;
};

export function useFeedbackCommands({
  apiClient,
  currentProfile,
  setData,
  setFeedbackDialogOpen,
  setSaveError,
  setSelectedFeedbackId,
  source,
  startTransition,
}: UseFeedbackCommandsOptions) {
  const [feedbackMessage, setFeedbackMessage] = useState("");

  const createFeedback = (draft: FeedbackDraft) => {
    if (!currentProfile) {
      setFeedbackMessage("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }

    setFeedbackMessage("");
    setSaveError("");

    const localFeedback: FeedbackItem = {
      id: Date.now(),
      type: draft.type,
      status: "open",
      severity: draft.severity,
      profileId: currentProfile.id,
      title: draft.title.trim(),
      description: draft.description.trim(),
      pageUrl: draft.pageUrl.trim(),
      createdAt: new Date().toISOString(),
    };

    setData((current) => ({
      ...current,
      feedbackItems: [localFeedback, ...current.feedbackItems],
    }));
    setSelectedFeedbackId(localFeedback.id);

    if (source !== "supabase") {
      setFeedbackMessage("Feedback wurde lokal erfasst. Mit Supabase wird es als Notification an CEO/Deputy gesendet.");
      setFeedbackDialogOpen(false);
      return;
    }

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.createFeedbackRequest(apiClient, draft);
        if (!response.ok || !body?.feedback) throw new Error(body?.error || "Feedback konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          feedbackItems: [body.feedback!, ...current.feedbackItems.filter((item) => item.id !== localFeedback.id)],
        }));
        setSelectedFeedbackId(body.feedback.id);
        setFeedbackMessage("Feedback wurde gesendet und als Notification zugestellt.");
        setFeedbackDialogOpen(false);
      } catch (error) {
        setData((current) => ({
          ...current,
          feedbackItems: current.feedbackItems.filter((item) => item.id !== localFeedback.id),
        }));
        setSelectedFeedbackId(null);
        setFeedbackMessage(error instanceof Error ? error.message : "Feedback konnte nicht gespeichert werden.");
      }
    });
  };

  return {
    createFeedback,
    feedbackMessage,
  };
}
