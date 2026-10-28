import type { FounderSprintScore, ScoreObjection, ScoreObjectionResolutionInput } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";

export type ScoreObjectionConfirmation = { objection: ScoreObjection; score?: FounderSprintScore | null };
export type ScoreObjectionOutcome = ({ ok: true } & ScoreObjectionConfirmation) | {
  ok: false;
  kind: "versionConflict" | "rejected" | "unconfirmed" | "sessionSuperseded";
  error: string;
};
export type ScoreObjectionOperation = {
  id: string;
  sprintId: string;
  profileId: string;
  objectionId: number | null;
  phase: "editing" | "saving" | "saved" | "conflict" | "rejected" | "unconfirmed" | "blocked" | "ended";
  submitted: ScoreObjectionResolutionInput | { comment: string } | null;
  originalObjection: ScoreObjection | null;
  error: string;
  serverObjection: ScoreObjection | null;
  serverScore: FounderSprintScore | null;
  canResave: boolean;
  checkStatus: PlanningReadStatus | "not-checked" | "checking";
};
export interface ScoreObjectionEditor {
  view(): ScoreObjectionOperation;
  submit(input: ScoreObjectionResolutionInput): Promise<ScoreObjectionOutcome>;
  refreshConflict(): Promise<boolean>;
  resubmit(input: ScoreObjectionResolutionInput): Promise<ScoreObjectionOutcome>;
  checkOutcome(): Promise<PlanningTaskSaveCheck>;
  close(): void;
}
export interface ScoreObjectionCreationEditor {
  view(): ScoreObjectionOperation;
  submit(comment: string): Promise<ScoreObjectionOutcome>;
  checkOutcome(): Promise<PlanningTaskSaveCheck>;
  close(): void;
}
