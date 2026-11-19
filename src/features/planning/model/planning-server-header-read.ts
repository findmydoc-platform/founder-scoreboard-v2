import type { PlanningHeaderData } from "@/lib/types";

// Absolute milliseconds from the original server binding, separate from provider session expiry.
export type PlanningReadAuthority = Readonly<{ userId: string; deadline: number }>;
// timeoutAt retains the existing Header request timeout; it never extends read authority.
export type PlanningServerHeaderRead = PlanningReadAuthority & Readonly<{ id: string; sessionRevision: string; timeoutAt: number }>;
export type PlanningServerHeaderSlot = "quickLinks" | "calendarEvents";
export type PlanningServerHeaderResult = Readonly<{ headerData: PlanningHeaderData }>;
