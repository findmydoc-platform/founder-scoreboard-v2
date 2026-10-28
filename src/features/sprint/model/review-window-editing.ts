import type { PlanningReadStatus, PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
export type ReviewWindowConfirmation = { project: { id: string; reviewObjectionWindowHours: number }; sprints: { id: string; reviewDueAt: string }[] };
export type ReviewWindowResult = { ok: true } | { ok: false; kind: "versionConflict" | "rejected" | "unconfirmed" | "sessionSuperseded"; error: string; code?: string };
export type ReviewWindowEditorView = { phase: "editing" | "saving" | "saved" | "conflict" | "rejected" | "unconfirmed" | "blocked" | "ended"; submittedHours: number | null; serverHours: number | null; error: string; canResave: boolean };
export type ReviewWindowView = { hours: number | null; edits: readonly ReviewWindowEditorView[]; readStatus: PlanningReadStatus };
export interface ReviewWindowEditor {
  view(): ReviewWindowEditorView;
  save(hours: number): Promise<ReviewWindowResult>;
  refreshConflict(): Promise<boolean>;
  resave(hours: number): Promise<ReviewWindowResult>;
  checkOutcome(): Promise<PlanningTaskSaveCheck>;
  close(): void;
}
