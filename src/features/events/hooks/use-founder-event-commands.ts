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
}: PlanningCommandContext) {
  const [eventMessage, setEventMessage] = useState("");

  const createFounderEvent = async (draft: FounderEventDraft) => {
    setSaveError("");
    setEventMessage("");

    let startsAt: string;
    let endsAt: string;
    try {
      startsAt = validIsoDateTime(draft.startsAt, "Startzeit");
      endsAt = draft.endsAt ? validIsoDateTime(draft.endsAt, "Endzeit") : startsAt;
      if (endsAt < startsAt) throw new Error("Die Endzeit darf nicht vor der Startzeit liegen.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Event-Zeit ist ungültig.";
      setSaveError(message);
      throw error instanceof Error ? error : new Error(message);
    }
    const now = new Date().toISOString();
    const localEvent: FounderEvent = {
      id: Date.now(),
      title: draft.title.trim(),
      category: draft.category,
      startsAt,
      endsAt,
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

    try {
      const payload = { ...draft, startsAt, endsAt: draft.endsAt ? endsAt : "" };
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
      const message = error instanceof Error ? error.message : "Event konnte nicht gespeichert werden.";
      setSaveError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const updateFounderEvent = async (event: FounderEvent, draft: FounderEventDraft) => {
    setSaveError("");
    setEventMessage("");

    let startsAt: string;
    let endsAt: string;
    try {
      startsAt = validIsoDateTime(draft.startsAt, "Startzeit");
      endsAt = draft.endsAt ? validIsoDateTime(draft.endsAt, "Endzeit") : startsAt;
      if (endsAt < startsAt) throw new Error("Die Endzeit darf nicht vor der Startzeit liegen.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Event-Zeit ist ungültig.";
      setSaveError(message);
      throw error instanceof Error ? error : new Error(message);
    }
    const nextEvent: FounderEvent = {
      ...event,
      title: draft.title.trim(),
      category: draft.category,
      startsAt,
      endsAt,
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

    try {
      const payload = { ...draft, startsAt, endsAt: draft.endsAt ? endsAt : "" };
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
      const message = error instanceof Error ? error.message : "Event konnte nicht aktualisiert werden.";
      setSaveError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  return {
    createFounderEvent,
    eventMessage,
    updateFounderEvent,
  };
}

function validIsoDateTime(value: string, label: string) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} ist ungültig. Bitte Datum und Uhrzeit vollständig auswählen.`);
  }
  return parsed.toISOString();
}
