import type { Task, TaskActivity } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
export type TaskAttachmentReceipt = {
 filename: string; contentType: string; size: number; markdown: string; path: string; url: string; htmlUrl: string;
 activity: TaskActivity | null; effects: "confirmed" | "unconfirmed"; warning?: string;
};
export type TaskAttachmentUploadView = {
 id: string; taskId: string; filename: string; contentType: string; size: number;
 phase: "uploading" | "uploaded" | "rejected" | "unconfirmed";
 markdown: string; url: string; error: string; warning: string;
 effects: "pending" | "confirmed" | "unconfirmed"; taskReadStatus: PlanningReadStatus; checking: boolean;
};
export type TaskAttachmentUploadResult = { ok: true; markdown: string } | { ok: false; kind: "blocked" | "ended" | "rejected" | "unconfirmed"; error: string };
export interface TaskAttachmentAdapter { uploadTaskAttachment?(taskId: string, file: File): Promise<TaskAttachmentReceipt> }
export interface PlanningTaskAttachments {
 uploadTaskAttachment(task: Task, file: File): Promise<TaskAttachmentUploadResult>;
 taskAttachmentUploads(taskId: string): readonly TaskAttachmentUploadView[];
 checkTaskAttachmentUpload(id: string): Promise<PlanningTaskSaveCheck>;
}
