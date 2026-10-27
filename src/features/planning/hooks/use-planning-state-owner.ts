"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { createBrowserApiClient } from "@/lib/browser-api-client";
import { createBrowserSessionAdapter, type BrowserSessionSnapshot } from "@/lib/credentials/browser";
import type { AuthenticatedProfile, PlanningHeaderData, PlanningShellState } from "@/lib/types";
import * as planningApi from "../model/planning-api-client";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { taskUpdateRequestPayload } from "@/features/tasks/model/task-mutation-contract";
import { createPlanningState } from "../model/internal/planning-state-owner";
import { normalizePlanningShellState } from "../model/planning-app-model";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { isSupportingWorkspace, supportingWorkspaceModelToPlanningShellState } from "../model/supporting-planning-shell-projection";
import { sprintWorkspaceModelToPlanningShellState } from "@/features/sprint/model/sprint-planning-shell-projection";
import { mergePlanningHeaderData, normalizePlanningHeaderData } from "@/lib/planning-header-data";
import { getProtectedPlanningShellStateCache, setProtectedPlanningShellStateCache } from "./use-planning-auth";
import type { AppWorkspace } from "../model/workspace-routes";

export function usePlanningStateOwner(options: {
  initialData: PlanningShellState;
  initialHeaderData: PlanningHeaderData;
  initialCurrentProfile: AuthenticatedProfile | null;
  initialUserId: string;
  initialWorkspace: AppWorkspace;
  setHeaderData: (data: PlanningHeaderData) => void;
}) {
  const [bundle] = useState(() => {
    const runtime = { apiClient: createBrowserApiClient(), workspace: options.initialWorkspace, userId: options.initialUserId, session: null as BrowserSessionSnapshot | null, headerData: options.initialHeaderData, currentProfile: options.initialCurrentProfile };
    const owner = createPlanningState({
      userId: options.initialUserId,
      initialData: options.initialData,
      initialWorkspace: options.initialWorkspace,
      adapter: {
        async saveTask(task, patch) {
          const { response, body } = await taskApi.updateTaskRequest(runtime.apiClient, task.id, taskUpdateRequestPayload(patch, task.updatedAt || ""));
          if (!response.ok) throw Object.assign(new Error(body?.error || "Änderung konnte nicht gespeichert werden."), { status: response.status });
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
        runtime.headerData = mergePlanningHeaderData(runtime.headerData, normalizePlanningHeaderData(result.headerData));
        runtime.currentProfile = result.currentProfile || runtime.currentProfile;
        options.setHeaderData(runtime.headerData);
      },
      publishCache(data, workspace) {
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
        const result = await runtime.apiClient.requestJson<T>(input, requestOptions);
        const method = requestOptions?.method?.toUpperCase() || "GET";
        if (!["GET", "HEAD"].includes(method) && result.response.ok && /^\/api\/(tasks|sprints)(?:\/|$)/.test(String(input))) {
          owner.internal.invalidateTaskViews();
          // Legacy task writers have no provenance contract. Re-read instead of accepting their snapshots.
          void owner.planning.refreshWorkspace(runtime.workspace).catch(() => undefined);
        }
        return result;
      },
      requestForm: (...args) => runtime.apiClient.requestForm(...args),
      requestBlob: (...args) => runtime.apiClient.requestBlob(...args),
    };
    return { owner, runtime, legacyApiClient, acceptProtectedData: (data: PlanningShellState, account: string) => { runtime.userId = account; owner.internal.acceptHydration(data, account, runtime.workspace); } };
  });
  const data = useSyncExternalStore(bundle.owner.planning.subscribe, bundle.owner.internal.getSnapshot, bundle.owner.internal.getSnapshot);
  useEffect(() => {
    const sessions = createBrowserSessionAdapter();
    let active = true;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const acceptSession = (session: BrowserSessionSnapshot | null) => {
      if (!active) return;
      if (expiry) clearTimeout(expiry);
      bundle.runtime.session = session;
      bundle.owner.internal.bindSession(session);
      if (session) expiry = setTimeout(() => bundle.owner.internal.suspendProtected(), Math.max(0, session.expiresAt * 1000 - Date.now()));
    };
    const unsubscribe = sessions.subscribe(acceptSession);
    void sessions.current().then(acceptSession).catch(() => undefined);
    return () => { active = false; unsubscribe(); if (expiry) clearTimeout(expiry); };
  }, [bundle]);
  return {
    data,
    planningState: bundle.owner.planning,
    setData: bundle.owner.internal.applyLegacyProjection,
    acceptProtectedData: bundle.acceptProtectedData,
    clearPlanningState: bundle.owner.internal.suspendProtected,
    legacyApiClient: bundle.legacyApiClient,
    configure: (apiClient: BrowserApiClient, workspace: AppWorkspace, headerData: PlanningHeaderData, currentProfile: AuthenticatedProfile | null) => {
      Object.assign(bundle.runtime, { apiClient, workspace, headerData, currentProfile });
    },
  };
}
