import type { FounderEvent, Profile } from "@/lib/types";

export type EventsWorkspaceModel = Readonly<{
  revision: string;
  readCoverage?: Readonly<{ people?: "complete" | "partial" }>;
  coverage: import("./event-state").EventCoverage;
  events: readonly FounderEvent[];
  people: readonly Profile[];
}>;

export type EventsLoadResult = { status: "ready"; model: EventsWorkspaceModel } | { status: "forbidden" } | { status: "unavailable" };

export interface EventsReadModel {
  load(context: { authorized: boolean; actorProfileId: string | null }): Promise<EventsLoadResult>;
}
