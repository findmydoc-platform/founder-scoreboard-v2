import type { Sprint } from "@/lib/types";
import type { SprintPlanningOptions } from "./sprint-planning-options";
import type { PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
export type SprintPlanBasis = { sprints: readonly Sprint[]; reviewObjectionWindowHours: number };
export type SprintPlanConfirmation = { sprints: Sprint[] };
export type SprintPlanResult = { ok: true; changedCount: number } | { ok: false; kind: "versionConflict" | "planChangedOrProtected" | "rejected" | "unconfirmed" | "sessionSuperseded"; error: string; code?: string };
export type SprintPlanEditorView = { phase: "editing" | "saving" | "saved" | "conflict" | "rejected" | "unconfirmed" | "blocked" | "ended"; submitted: Readonly<SprintPlanningOptions> | null; error: string; changedCount: number | null; canRecreate: boolean; serverSprints: readonly Sprint[] | null };
export type SprintPlanView = { provisionalSprintIds: readonly string[]; edits: readonly SprintPlanEditorView[] };
export interface SprintPlanEditor {
  view(): SprintPlanEditorView;
  create(options: SprintPlanningOptions): Promise<SprintPlanResult>;
  refreshConflict(): Promise<boolean>;
  recreate(options: SprintPlanningOptions): Promise<SprintPlanResult>;
  checkOutcome(): Promise<PlanningTaskSaveCheck>;
  close(): void;
}
