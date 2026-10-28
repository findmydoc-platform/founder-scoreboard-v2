import type { FounderEvent } from "@/lib/types";
import type { PlanningReadStatus } from "@/features/planning/model/planning-state";

export type FounderEventDraft = Pick<FounderEvent, "title" | "category" | "startsAt" | "endsAt" | "location" | "description" | "audienceMode" | "participantProfileIds" | "reminderDaysBefore" | "status"> & { id?: number };
/** Half-open range of event start times, represented as ISO instants. */
export type EventRange = { from: string; to: string };
export type EventCoverage = { range: EventRange | null; completeness: "complete" | "partial" };
export type EventRead = { events: readonly FounderEvent[]; coverage: EventCoverage; headerData?: import("@/lib/types").PlanningHeaderData };
export type EventConfirmation = { event: FounderEvent; warning?: string };
export type EventResult = { phase: "saved" | "rejected" | "conflict" | "unconfirmed" | "session-ended"; error?: string; warning?: string };
export type EventOperation = { id: string; eventId: number; draft: Readonly<FounderEventDraft>; phase: "saving" | "saved" | "rejected" | "conflict" | "unconfirmed"; error: string; checking: boolean; warning?: string };
export type EventsView = { events: readonly FounderEvent[]; readStatus: PlanningReadStatus; coverage: EventCoverage | null; operations: readonly EventOperation[] };
export interface PlanningEventsState {
  events(): EventsView;
  refreshEvents(range?: EventRange | null): Promise<boolean>;
  createEvent(submissionId: string, draft: FounderEventDraft): Promise<EventResult>;
  updateEvent(submissionId: string, basis: FounderEvent, draft: FounderEventDraft): Promise<EventResult>;
  checkEventOutcome(submissionId: string): Promise<boolean>;
}
export type EventsAdapter = {
  readEvents?: (range: EventRange | null) => Promise<EventRead>;
  createEvent?: (draft: FounderEventDraft) => Promise<EventConfirmation>;
  updateEvent?: (basis: FounderEvent, draft: FounderEventDraft) => Promise<EventConfirmation>;
};
