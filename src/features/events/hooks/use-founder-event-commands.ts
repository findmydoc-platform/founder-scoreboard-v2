"use client";

import { useState } from "react";
import type { FounderEventDraft, EventResult } from "../model/event-state";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import type { FounderEvent } from "@/lib/types";

export function useFounderEventCommands({ planningState, setSaveError }: Pick<PlanningCommandContext, "planningState" | "setSaveError">) {
  const [eventMessage, setEventMessage] = useState("");
  function finish(result: EventResult, title: string) {
    if (result.phase !== "saved") {
      const error = result.error || "Ob das Event gespeichert wurde, ist noch unklar. Deine Eingaben bleiben erhalten. Prüfe den aktuellen Stand.";
      setEventMessage(""); setSaveError(error); throw new Error(error);
    }
    setEventMessage(result.warning || `Event gespeichert: ${title}`);
  }
  return {
    eventMessage,
    async createFounderEvent(draft: FounderEventDraft, submissionId: string) {
      setSaveError(""); setEventMessage("");
      finish(await planningState.createEvent(submissionId, draft), draft.title);
    },
    async updateFounderEvent(event: FounderEvent, draft: FounderEventDraft, submissionId: string) {
      setSaveError(""); setEventMessage("");
      finish(await planningState.updateEvent(submissionId, event, draft), draft.title);
    },
  };
}
