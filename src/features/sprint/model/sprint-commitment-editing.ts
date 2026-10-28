import type { SprintCommitment } from "@/lib/types";
import type { PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
export type SprintCommitmentPatch = Partial<Pick<SprintCommitment, "commitmentLevel" | "weeklyHours" | "note">>;
export type SprintCommitmentConfirmation = { commitment: SprintCommitment; auditError?: string; };
export type SprintCommitmentResult = ({ ok: true ;} & SprintCommitmentConfirmation) | { ok: false; kind: "versionConflict" | "rejected" | "unconfirmed" | "sessionSuperseded"; error: string ;};
export type SprintCommitmentEditView = { phase: "editing" | "saving" | "saved" | "conflict" | "rejected" | "unconfirmed" | "blocked" | "ended"; submitted: Readonly<SprintCommitmentPatch> | null; serverCommitment: SprintCommitment | null; error: string; canResave: boolean; checkStatus?: "not-checked" | "checking" | "checked" | "unavailable" | "forbidden"; };
export interface SprintCommitmentEditor {
  view(): SprintCommitmentEditView;
  save(patch: SprintCommitmentPatch): Promise<SprintCommitmentResult>;
  refreshConflict(): Promise<boolean>;
  resave(patch: SprintCommitmentPatch): Promise<SprintCommitmentResult>;
  checkOutcome(): Promise<PlanningTaskSaveCheck>;
  close(): void;
}
