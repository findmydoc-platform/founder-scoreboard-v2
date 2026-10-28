import type { ApprovalDecisionAction, ApprovalStatus, Task } from "@/lib/types";
import type { PlanningTaskEditorView, PlanningTaskSaveCheck, PlanningWorkspaceView } from "@/features/planning/model/planning-state";
import type { EpicStatus } from "./epic-contract";
export type EpicDraft = {
  id?: string;
  creationRequestId: string;
  title: string;
  description: string;
  targetDate: string;
  status: EpicStatus;
  expectedUpdatedAt?: string;
};
export type InitiativeDraft = {
  id?: string;
  expectedUpdatedAt?: string;
  creationRequestId: string;
  title: string;
  parentTaskId: string;
  ownerId: string;
  accountableProfileId: string;
  responsibleProfileIds: string[];
  consultedProfileIds: string[];
  informedProfileIds: string[];
  priority: string;
  status: "planned" | "active" | "done" | "paused";
  targetDate: string;
  goal: string;
  successCriteria: string;
  scopeConstraints: string;
  approveNow: boolean;
  approvalStatus?: ApprovalStatus;
  approvalRevision?: number;
  decisionNote?: string;
};
export type HierarchySaveResult = import("@/features/tasks/hooks/task-mutation-command-types").TaskUpdateResult
  | import("@/features/planning/model/planning-task-lifecycle").PlanningTaskCreationResult;
export type HierarchyEditorView = Omit<PlanningTaskEditorView, "phase"> & {
  phase: PlanningTaskEditorView["phase"] | "partiallyConfirmed";
  parentConfirmed?: boolean;
  stage?: "parent" | "content" | "create";
};
export type HierarchyEditor<Draft> = {
  view(): HierarchyEditorView;
  save(draft: Draft): Promise<HierarchySaveResult>;
  resave(draft: Draft): Promise<HierarchySaveResult>;
  refreshConflict(): Promise<boolean>;
  checkOutcome(): Promise<PlanningTaskSaveCheck>;
  close(): void;
};
export type HierarchyEditView = HierarchyEditorView & {
  id: string;
  taskId: string;
  kind: "epic" | "initiative";
  parentConfirmed: boolean;
};
export interface PlanningHierarchy {
  hierarchyEdits(): readonly HierarchyEditView[];
  checkHierarchyEdit(id: string): Promise<PlanningTaskSaveCheck>;
  hierarchy(): PlanningWorkspaceView;
  beginEpicEdit(basis: Pick<EpicDraft, "id" | "expectedUpdatedAt" | "creationRequestId">): HierarchyEditor<EpicDraft>;
  beginInitiativeEdit(basis: Pick<InitiativeDraft, "id" | "expectedUpdatedAt" | "creationRequestId">): HierarchyEditor<InitiativeDraft>;
  deleteEmptyEpic(task: Task): Promise<import("@/features/planning/model/planning-task-lifecycle").PlanningTaskRemovalResult>;
  decideInitiativeApproval(task: Task, action: ApprovalDecisionAction, note?: string): Promise<HierarchySaveResult>;
}
