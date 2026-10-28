import type { FmdTool, PlanningHeaderData } from "@/lib/types";
import type { PlanningReadStatus } from "@/features/planning/model/planning-state";
import type { FmdToolDraft, FmdToolPreviewImageUpload } from "./fmd-tools";
export type ToolRead = { tools: readonly FmdTool[]; completeness: "complete" | "partial"; headerData?: PlanningHeaderData };
export type ToolConfirmation = { tool: FmdTool; warning?: string };
export type ToolResult = { phase: "saved" | "rejected" | "conflict" | "unconfirmed" | "session-ended"; error?: string; warning?: string };
export type ToolOperation = { id: string; toolId: string; draft: Readonly<FmdToolDraft>; phase: "saving" | "saved" | "rejected" | "conflict" | "unconfirmed"; error: string; warning?: string; checking: boolean };
export type ToolPreviewView = { id: string; fileName: string; phase: "uploading" | "uploaded" | "rejected" | "unconfirmed"; image?: FmdToolPreviewImageUpload; error: string; checking: boolean; verification: "not-checked" | "present" | "unavailable" | "no-reference" | "forbidden" };
export type ToolPreviewResult = { phase: "uploaded" | "rejected" | "unconfirmed" | "session-ended"; image?: FmdToolPreviewImageUpload; error?: string };
export type ToolsView = { tools: readonly FmdTool[]; completeness: "complete" | "partial"; readStatus: PlanningReadStatus; curatedCount: number | null; operations: readonly ToolOperation[]; previews: readonly ToolPreviewView[] };
export interface PlanningToolsState {
  tools(): ToolsView;
  refreshTools(): Promise<boolean>;
  createTool(submissionId: string, draft: FmdToolDraft): Promise<ToolResult>;
  updateTool(submissionId: string, basis: FmdTool, draft: FmdToolDraft): Promise<ToolResult>;
  checkToolOutcome(submissionId: string): Promise<boolean>;
  uploadToolPreview(uploadId: string, file: File): Promise<ToolPreviewResult>;
  checkToolPreview(uploadId: string): Promise<{ phase: ToolPreviewResult["phase"]; verification: ToolPreviewView["verification"] }>;
}
export type ToolsAdapter = {
  readTools?: () => Promise<ToolRead>;
  createTool?: (draft: FmdToolDraft & Pick<FmdTool, "status" | "kind">) => Promise<ToolConfirmation>;
  updateTool?: (basis: FmdTool, draft: FmdToolDraft & Pick<FmdTool, "status" | "kind">) => Promise<ToolConfirmation>;
  uploadToolPreview?: (file: File) => Promise<FmdToolPreviewImageUpload>;
  readToolPreview?: (imageUrl: string) => Promise<boolean>;
};
