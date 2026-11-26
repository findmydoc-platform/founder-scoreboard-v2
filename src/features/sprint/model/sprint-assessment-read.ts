import type { PlanningReadAuthority } from "@/features/planning/model/planning-server-header-read";
import type { PlatformRole } from "@/lib/types";
import type { SprintScoreRow } from "./sprint-score-table-view-model";

export type SprintAssessmentSource = Readonly<{
  sprintId: string;
  sourceRevision: string;
  readAuthority: PlanningReadAuthority;
  readActor: Readonly<{ profileId: string; platformRole: PlatformRole }>;
}>;

export type SprintAssessmentReceipt = SprintAssessmentSource & Readonly<{
  evaluatedAt: string;
  validUntil: string;
  scoreLocked: boolean;
  scoreRows: readonly SprintScoreRow[];
  inputCounts: Readonly<Record<"people" | "items" | "commitments" | "scores" | "strikeStates" | "objections" | "meetings" | "attendance", number>>;
}>;

export type SprintAssessmentResult<T = SprintAssessmentReceipt> = { status: "ready"; read: T }
  | { status: "forbidden" | "notFound" | "stale" | "unavailable" };
