"use client";

import { useState } from "react";
import type { FounderEventDraft } from "@/features/events/organisms/events-overview";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { FounderEvent } from "@/lib/types";

export function useFounderEventCommands({
  apiClient,
  currentProfile,
  data,
  setData,
  setSaveError,
  source,
  startTransition,
}: PlanningCommandContext) {
  const [eventMessage, setEventMessage] = useState("");

  const createFounderEvent = (draft: FounderEventDraft) => {
    setSaveError("");
    setEventMessage("");

    const now = new Date().toISOString();
    const localEvent: FounderEvent = {
      id: Date.now(),
      title: draft.title.trim(),
      category: draft.category,
      startsAt: new Date(draft.startsAt).toISOString(),
      endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : new Date(draft.startsAt).toISOString(),
      location: draft.location.trim(),
      description: draft.description.trim(),
      audienceMode: draft.audienceMode,
      participantProfileIds: draft.audienceMode === "selected" ? draft.participantProfileIds : [],
      reminderDaysBefore: draft.reminderDaysBefore,
      reminderGeneratedAt: "",
      status: "planned",
      createdBy: currentProfile?.id || "",
      createdAt: now,
      updatedAt: now,
    };
    const previousData = data;

    setData((current) => ({ ...current, events: [localEvent, ...current.events] }));
    setEventMessage(`Event vorgemerkt: ${localEvent.title}`);

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const payload = {
          ...draft,
          startsAt: new Date(draft.startsAt).toISOString(),
          endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : "",
        };
        const { response, body } = await planningApi.createFounderEventRequest(apiClient, payload);
        if (!response.ok || !body?.event) throw new Error(body?.error || "Event konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          events: current.events.map((item) => (item.id === localEvent.id ? body.event! : item)),
        }));
        setEventMessage(`Event gespeichert: ${body.event.title}`);
      } catch (error) {
        setData(previousData);
        setEventMessage("");
        setSaveError(error instanceof Error ? error.message : "Event konnte nicht gespeichert werden.");
      }
    });
  };

  const updateFounderEvent = (event: FounderEvent, draft: FounderEventDraft) => {
    setSaveError("");
    setEventMessage("");

    const nextEvent: FounderEvent = {
      ...event,
      title: draft.title.trim(),
      category: draft.category,
      startsAt: new Date(draft.startsAt).toISOString(),
      endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : new Date(draft.startsAt).toISOString(),
      location: draft.location.trim(),
      description: draft.description.trim(),
      audienceMode: draft.audienceMode,
      participantProfileIds: draft.audienceMode === "selected" ? draft.participantProfileIds : [],
      reminderDaysBefore: draft.reminderDaysBefore,
      status: draft.status,
      updatedAt: new Date().toISOString(),
    };
    const previousData = data;

    setData((current) => ({
      ...current,
      events: current.events.map((item) => (item.id === event.id ? nextEvent : item)),
    }));
    setEventMessage(nextEvent.status === "cancelled" ? `Event abgesagt: ${nextEvent.title}` : `Event aktualisiert: ${nextEvent.title}`);

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const payload = {
          ...draft,
          startsAt: new Date(draft.startsAt).toISOString(),
          endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : "",
        };
        const { response, body } = await planningApi.updateFounderEventRequest(apiClient, event.id, payload);
        if (!response.ok || !body?.event) throw new Error(body?.error || "Event konnte nicht aktualisiert werden.");

        setData((current) => ({
          ...current,
          events: current.events.map((item) => (item.id === event.id ? body.event! : item)),
        }));
        setEventMessage(body.event.status === "cancelled" ? `Event abgesagt: ${body.event.title}` : `Event aktualisiert: ${body.event.title}`);
      } catch (error) {
        setData(previousData);
        setEventMessage("");
        setSaveError(error instanceof Error ? error.message : "Event konnte nicht aktualisiert werden.");
      }
    });
  };

  return {
    createFounderEvent,
    eventMessage,
    updateFounderEvent,
  };
}
