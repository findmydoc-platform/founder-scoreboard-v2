"use client";

import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { TaskIntakePreviewTask } from "@/lib/task-intake";
import type { Task } from "@/lib/types";

export type TaskIntakeResponse = {
  ok?: boolean;
  valid?: boolean;
  error?: string;
  tasks?: TaskIntakePreviewTask[];
};

export type TaskIntakeCommitResponse = {
  ok?: boolean;
  error?: string;
  tasks?: Task[];
};

export function previewTaskIntake(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<TaskIntakeResponse>("/api/ceo/task-intake/preview", {
    method: "POST",
    json: payload,
  });
}

export function commitTaskIntake(apiClient: BrowserApiClient, payload: unknown) {
  return apiClient.requestJson<TaskIntakeCommitResponse>("/api/ceo/task-intake/commit", {
    method: "POST",
    json: payload,
  });
}
