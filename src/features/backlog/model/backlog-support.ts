import type { BacklogSprintBucket } from "./backlog-view-model";
import type { PlanningLevel } from "@/features/planning/model/planning-level";

export type BacklogSupportQuery = Readonly<{ view: "backlog-support"; area: "controls" | "sprints"; day: string }>;
type Receipt = Readonly<{ coverage: "complete"; sourceRevision: string; scopeRevision: string; observedAt: string; validUntil: string }>;
type Option = Readonly<{ value: string; label: string }>;
export type BacklogControls = Receipt & Readonly<{
  levelTotals: Record<PlanningLevel, number>;
  statuses: Record<PlanningLevel, readonly string[]>;
  assignees: readonly Option[];
  epics: readonly Option[];
  initiatives: readonly Option[];
}>;
export type BacklogSprintBasis = Receipt & Readonly<{ day: string; buckets: readonly BacklogSprintBucket[] }>;

export function normalizeBacklogSupport(input: unknown): BacklogSupportQuery | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.view !== "backlog-support" || value.area !== "controls" && value.area !== "sprints"
    || typeof value.day !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value.day)
    || !Number.isFinite(Date.parse(`${value.day}T00:00:00Z`)) || new Date(`${value.day}T00:00:00Z`).toISOString().slice(0, 10) !== value.day) return null;
  return { view: "backlog-support", area: value.area, day: value.day };
}
