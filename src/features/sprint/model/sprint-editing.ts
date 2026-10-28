import type { Sprint } from "@/lib/types";
import type { PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
export const sprintStatusLabels: Record<Sprint["status"], string> = { planning: "Planung", active: "Aktiv", review: "Review", closed: "Abgeschlossen" };
export type SprintEditPatch = Partial<Pick<Sprint, "name" | "status" | "startDate" | "endDate">>;
export type SprintEditResult = { ok: true; sprint: Sprint } | { ok: false; kind: "versionConflict" | "rejected" | "unconfirmed" | "sessionSuperseded"; error: string; code?: string };
export type SprintEditorView = { phase: "editing" | "saving" | "saved" | "conflict" | "rejected" | "unconfirmed" | "blocked" | "ended"; submitted: Readonly<SprintEditPatch> | null; serverSprint: Sprint | null; error: string; canResave: boolean };
export interface SprintEditor {
  view(): SprintEditorView;
  save(patch: SprintEditPatch): Promise<SprintEditResult>;
  refreshConflict(): Promise<boolean>;
  resave(patch: SprintEditPatch): Promise<SprintEditResult>;
  checkOutcome(): Promise<PlanningTaskSaveCheck>;
  close(): void;
}
