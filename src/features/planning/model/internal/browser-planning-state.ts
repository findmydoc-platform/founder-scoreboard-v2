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
import { normalizePlanningHeaderData } from "@/lib/planning-header-data";
import { setProtectedPlanningShellStateCache } from "@/features/planning/model/internal/planning-protected-cache";
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
    initialHeaderData: options.initialHeaderData,
    adapter: {
      async readHeader(slots) {
        const { response, body } = await planningApi.requestPlanningHeaderData(runtime.apiClient, slots);
        if (!response.ok || !body?.headerData) throw Object.assign(new Error(body?.error || "Headerdaten konnten nicht geladen werden."), { status: response.status });
        return normalizePlanningHeaderData(body.headerData);
      },
      async updateNotification(eventId, action) {
        const { response, body } = await planningApi.updateNotificationStatusRequest(runtime.apiClient, eventId, action);
        if (!response.ok) throw Object.assign(new Error(body?.error || "Benachrichtigung konnte nicht aktualisiert werden."), { status: response.status, code: body?.code });
        if (!body?.ok || !body.action || !body.status) throw new Error("Bestätigung unvollständig.");
        return { action: body.action, status: body.status };
      },
      async readPlatformReleases() {
        const { response, body } = await runtime.apiClient.requestJson<{ releases?: import("@/features/platform-releases/model/platform-release-model").PlatformReleaseRecord[]; error?: string }>("/api/team/platform-releases/v1/releases");
        if (!response.ok || !Array.isArray(body?.releases)) throw Object.assign(new Error(body?.error || "Releases konnten nicht geladen werden."), { status: response.status });
        return body.releases;
      },
      async markPlatformReleaseSeen(version) {
        const { response, body } = await runtime.apiClient.requestJson<{ ok?: boolean; error?: string }>(`/api/team/platform-releases/v1/releases/${encodeURIComponent(version)}/seen`, { method: "POST" });
        if (!response.ok) throw Object.assign(new Error(body?.error || "Release konnte nicht bestätigt werden."), { status: response.status });
        if (!body?.ok) throw new Error("Bestätigung unvollständig.");
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
          return body?.model ? { data: normalizePlanningShellState(supportingWorkspaceModelToPlanningShellState(workspace, body.model)), notificationCoverage: workspace === "notifications" ? (body.model as import("@/features/notifications/model/notifications-read-model").NotificationsWorkspaceModel).coverage : undefined, taskCoverage: (workspace === "team" || workspace === "profile" || workspace === "notifications" ? "partial" : "none") as "partial" | "none", headerData: body.headerData, currentProfile: body.currentProfile } : null;
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
      runtime.headerData = owner.internal.confirmedHeader();
      runtime.currentProfile = result.currentProfile || runtime.currentProfile;
      headerListeners.forEach(listener => listener(runtime.headerData));
    },
    publishCache(data, workspace) {
      if (!isCurrent()) return;
      if (!data) { setProtectedPlanningShellStateCache(null, workspace); return; }
      workspace ??= runtime.workspace;
      const confirmedHeader = owner.internal.confirmedHeader();
      setProtectedPlanningShellStateCache({
        authUserId: runtime.userId,
        workspace,
        sessionRevision: runtime.session?.revision,
        authorityExpiresAt: runtime.session?.expiresAt,
        data,
        headerData: confirmedHeader,
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
    acceptHeaderHydration: owner.internal.acceptHeaderHydration,
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
