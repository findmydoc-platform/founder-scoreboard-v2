"use client";

import type { BrowserApiClient } from "@/lib/browser-api-client";
import { createBrowserApiClient } from "@/lib/browser-api-client";
import type { BrowserSessionSnapshot } from "@/lib/credentials/browser";
import type { AuthenticatedProfile, PlanningHeaderData, PlanningShellState } from "@/lib/types";
import * as planningApi from "../planning-api-client";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { taskUpdateRequestPayload } from "@/features/tasks/model/task-mutation-contract";
import { createPlanningState } from "./planning-state-owner";
import { normalizePlanningShellState } from "../planning-app-model";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { isSupportingWorkspace, supportingWorkspaceModelToPlanningShellState } from "../supporting-planning-shell-projection";
import { sprintWorkspaceModelToPlanningShellState } from "@/features/sprint/model/sprint-planning-shell-projection";
import { mergePlanningHeaderData, normalizePlanningHeaderData } from "@/lib/planning-header-data";
import { getProtectedPlanningShellStateCache, setProtectedPlanningShellStateCache } from "@/features/planning/model/internal/planning-protected-cache";
import type { AppWorkspace } from "../workspace-routes";

export type PlanningPageState = {
  initialData: PlanningShellState;
  initialHeaderData: PlanningHeaderData;
  initialCurrentProfile: AuthenticatedProfile | null;
  initialUserId: string;
  initialWorkspace: AppWorkspace;
};

export function createBrowserPlanningState(options: PlanningPageState, isCurrent: () => boolean = () => true) {
  const headerListeners = new Set<(data: PlanningHeaderData) => void>();
  const runtime = { apiClient: createBrowserApiClient(), workspace: options.initialWorkspace, userId: options.initialUserId, session: null as BrowserSessionSnapshot | null, headerData: options.initialHeaderData, currentProfile: options.initialCurrentProfile };
  const owner = createPlanningState({
    userId: options.initialUserId,
    initialData: options.initialData,
    initialWorkspace: options.initialWorkspace,
    adapter: {
      async createTask(input) {
        const { response, body } = await taskApi.createTaskRequest(runtime.apiClient, input);
        if (!response.ok && !(body?.code === "task_created_approval_failed" && body.task?.updatedAt)) throw Object.assign(new Error(body?.error || "Aufgabe konnte nicht erstellt werden."), { status: response.status, code: body?.code });
        if (!body?.task) throw new Error("Die Erstellung ist noch nicht bestätigt.");
        return { task: body.task, relation: body.relation, relatedTask: body.relatedTask, approvalError: body.code === "task_created_approval_failed" ? body.error || "Die Aufgabe wurde erstellt. Die Freigabe ist fehlgeschlagen." : undefined };
      },
      async removeTask(task, action, reason) {
        if (action === "withdraw") {
          const { response, body } = await taskApi.withdrawTaskRequest(runtime.apiClient, task.id, task.approvalRevision, reason);
          if (!response.ok) throw Object.assign(new Error(body?.error || "Deliverable konnte nicht zurückgezogen werden."), { status: response.status, code: body?.code });
          return { affectedTaskIds: body?.affectedTaskIds };
        }
        const { response, body } = await taskApi.decideTaskApprovalRequest(runtime.apiClient, task.id, "reject", task.approvalRevision, reason);
        if (!response.ok) throw Object.assign(new Error(body?.error || "Freigabeentscheidung konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        if (!body?.task?.updatedAt || body.task.approvalStatus !== "rejected") throw new Error("Die Ablehnung ist noch nicht bestätigt.");
        return {};
      },
      async saveTask(task, patch) {
        const { response, body } = await taskApi.updateTaskRequest(runtime.apiClient, task.id, taskUpdateRequestPayload(patch, task.updatedAt || ""));
        if (!response.ok) throw Object.assign(new Error(body?.error || "Änderung konnte nicht gespeichert werden."), { status: response.status, code: body?.code, kind: body?.conflictReason === "revision" ? "versionConflict" : undefined });
        return { task: body?.task || {}, activities: body?.activities };
      },
      async readTaskDetail(taskId) {
        const { response, body } = await taskApi.requestTaskDetailData(runtime.apiClient, taskId);
        if (!response.ok || !body?.taskDetail) throw Object.assign(new Error(body?.error || "Task-Details konnten nicht geladen werden."), { status: response.status });
        return { model: body.taskDetail, unavailable: body.unavailable };
      },
      async readWorkspace(workspace) {
        if (workspace === "planning" || workspace === "projects") {
          const { response, body } = await planningApi.requestPlanningWorkspaceData(runtime.apiClient, workspace);
          if (!response.ok) throw Object.assign(new Error(body?.error || "Planungsdaten konnten nicht geladen werden."), { status: response.status });
          return body?.model ? { data: normalizePlanningShellState(planningWorkspaceModelToPlanningShellState(body.model)), headerData: body.headerData, currentProfile: body.currentProfile } : null;
        }
        if (isSupportingWorkspace(workspace)) {
          const { response, body } = await planningApi.requestSupportingWorkspaceData(runtime.apiClient, workspace);
          if (!response.ok) throw Object.assign(new Error(body?.error || "Planungsdaten konnten nicht geladen werden."), { status: response.status });
          return body?.model ? { data: normalizePlanningShellState(supportingWorkspaceModelToPlanningShellState(workspace, body.model)), taskCoverage: (workspace === "team" || workspace === "profile" || workspace === "notifications" ? "partial" : "none") as "partial" | "none", headerData: body.headerData, currentProfile: body.currentProfile } : null;
        }
        if (workspace === "sprint") {
          const { response, body } = await planningApi.requestSprintWorkspaceData(runtime.apiClient);
          if (!response.ok) throw Object.assign(new Error(body?.error || "Planungsdaten konnten nicht geladen werden."), { status: response.status });
          return body?.model ? { data: normalizePlanningShellState(sprintWorkspaceModelToPlanningShellState(body.model)), headerData: body.headerData, currentProfile: body.currentProfile } : null;
        }
        return null;
      },
    },
    acceptWorkspaceContext(result) {
      if (!isCurrent()) return;
      runtime.headerData = mergePlanningHeaderData(runtime.headerData, normalizePlanningHeaderData(result.headerData));
      runtime.currentProfile = result.currentProfile || runtime.currentProfile;
      headerListeners.forEach(listener => listener(runtime.headerData));
    },
    publishCache(data, workspace) {
      if (!isCurrent()) return;
      if (!data) { setProtectedPlanningShellStateCache(null, workspace); return; }
      workspace ??= runtime.workspace;
      const cached = getProtectedPlanningShellStateCache(workspace);
      setProtectedPlanningShellStateCache({
        authUserId: runtime.userId,
        workspace,
        sessionRevision: runtime.session?.revision,
        authorityExpiresAt: runtime.session?.expiresAt,
        data,
        headerData: cached?.authUserId === runtime.userId ? mergePlanningHeaderData(cached.headerData, runtime.headerData) : runtime.headerData,
        currentProfile: runtime.currentProfile,
      });
    },
  });
  const legacyApiClient: BrowserApiClient = {
    ...runtime.apiClient,
    async requestJson<T>(input: Parameters<BrowserApiClient["requestJson"]>[0], requestOptions: Parameters<BrowserApiClient["requestJson"]>[1]) {
      const workspace = runtime.workspace;
      const result = await runtime.apiClient.requestJson<T>(input, requestOptions);
      const method = requestOptions?.method?.toUpperCase() || "GET";
      if (!["GET", "HEAD"].includes(method) && result.response.ok && /^\/api\/(tasks|sprints)(?:\/|$)/.test(String(input))) {
        owner.internal.invalidateTaskViews();
        // Legacy task writers have no provenance contract. Re-read instead of accepting their snapshots.
        void owner.planning.refreshWorkspace(workspace).catch(() => undefined);
      }
      return result;
    },
    requestForm: (...args) => runtime.apiClient.requestForm(...args),
    requestBlob: (...args) => runtime.apiClient.requestBlob(...args),
  };
  return {
    initialPage: options,
    owner,
    runtime,
    legacyApiClient,
    subscribeHeader(listener: (data: PlanningHeaderData) => void) {
      headerListeners.add(listener);
      return () => { headerListeners.delete(listener); };
    },
    acceptProtectedData(data: PlanningShellState, account: string, workspace: AppWorkspace = runtime.workspace) {
      if (!isCurrent() || account !== runtime.userId) return;
      owner.internal.acceptHydration(data, account, workspace);
    },
  };

}

export type BrowserPlanningState = ReturnType<typeof createBrowserPlanningState>;
