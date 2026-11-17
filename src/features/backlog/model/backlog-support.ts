import type { BacklogSprintBucket } from "./backlog-view-model";
import type { PlanningLevel } from "@/features/planning/model/planning-level";

export type BacklogSupportQuery = Readonly<{ view: "backlog-support"; area: "controls" | "sprints"; day: string }>;
type Receipt = Readonly<{ coverage: "complete"; sourceRevision: string; scopeRevision: string; observedAt: string; validUntil: string }>;
type Option = Readonly<{ value: string; label: string }>;
export type BacklogControls = Receipt & Readonly<{
  levelTotals: Record<PlanningLevel, number>;
  scopeCounts: Record<import("./backlog-view-model").BacklogScope, number>;
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

function options(value: unknown): boolean {
  return Array.isArray(value) && value.every(option => option && typeof option.value === "string" && option.value && typeof option.label === "string")
    && new Set(value.map(option => option.value)).size === value.length;
}
export function validBacklogControls(value: BacklogControls | undefined) {
  return value && ["epic", "initiative", "deliverable"].every(level => {
    const key = level as keyof BacklogControls["levelTotals"];
    return Number.isSafeInteger(value.levelTotals?.[key]) && value.levelTotals[key] >= 0
      && Array.isArray(value.statuses?.[key]) && value.statuses[key].every(status => typeof status === "string");
  }) && ["all", "proposals", "ready", "unscheduled"].every(scope => {
    const count = value.scopeCounts?.[scope as keyof BacklogControls["scopeCounts"]];
    return Number.isSafeInteger(count) && count >= 0 && count <= value.scopeCounts.all;
  }) && value.scopeCounts.all <= value.levelTotals.deliverable && [value.assignees, value.epics, value.initiatives].every(options);
}
export function validBacklogBuckets(value: unknown): value is BacklogSprintBasis["buckets"] {
  return Array.isArray(value) && value.length <= 5 && new Set(value.map(bucket => bucket?.sprint?.id)).size === value.length
    && value.every(bucket => bucket?.sprint && typeof bucket.sprint.id === "string" && typeof bucket.sprint.name === "string"
      && ["planning", "active", "review"].includes(bucket.sprint.status) && typeof bucket.sprint.startDate === "string" && typeof bucket.sprint.endDate === "string"
      && typeof bucket.sprint.scoreLocked === "boolean" && typeof bucket.sprint.updatedAt === "string"
      && typeof bucket.isCurrent === "boolean" && bucket.locked === bucket.sprint.scoreLocked
      && Number.isFinite(bucket.plannedHours) && bucket.plannedHours >= 0 && bucket.plannedHoursComplete === true
      && (bucket.capacityHours === null || Number.isFinite(bucket.capacityHours) && bucket.capacityHours >= 0)
      && bucket.capacityUnavailable === (bucket.capacityHours === null)
      && Number.isFinite(bucket.overCapacityHours) && bucket.overCapacityHours >= 0 && typeof bucket.overCapacity === "boolean"
      && Number.isFinite(bucket.utilization) && bucket.utilization >= 0);
}
