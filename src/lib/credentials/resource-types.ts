import type { NextRequest } from "next/server";
import type { FounderEventRow } from "@/features/events/model/event-api";

export type ResourceReadAction = "events.read" | "tools.read" | "strategic.read" | "team.read" | "notifications.read";
export type ResourceAction = ResourceReadAction | "events.create" | "events.update" | "tools.create" | "tools.update" | "tools.metadata" | "notification.status.write" | "connection.github.read" | "connection.github.disconnect" | "assets.github.read" | "connection.google.read" | "connection.google.disconnect.preview" | "connection.google.disconnect";
export type ResourceCredentialInput = { credential: { kind: "session-request"; request: NextRequest }; action: ResourceAction; targetId?: string }
  | { credential: { kind: "server-cookies" }; action: ResourceReadAction };
export type ResourceAuditMetadata = { request_ip?: string | null; user_agent?: string | null };
export type EventWrite = FounderEventRow & { updated_at: string };
export type ResourceCredentialResult = Awaited<ReturnType<typeof import("./internal/resources").authorizeResource>>;
