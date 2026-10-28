"use client";

import { privateWorkweekApi } from "@/features/team-workweek/model/private-workweek-api";
import { requestBacklogModel } from "@/features/backlog/model/backlog-api-client";
import { backlogModelToPlanningShellState } from "@/features/backlog/model/backlog-planning-shell-projection";
import { backlogModelCoverage, backlogOmittedFields } from "./backlog-read-coverage";
import { readPublishedWorkweekCalendar } from "@/features/team-workweek/model/published-workweek-calendar-api";

import { isProtectedToolPreviewUrl } from "@/lib/tool-preview-image";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { createBrowserApiClient } from "@/lib/browser-api-client";
import type { BrowserSessionSnapshot } from "@/lib/credentials/browser";
import type { AuthenticatedProfile, PlanningHeaderData, PlanningShellState } from "@/lib/types";
import * as planningApi from "../planning-api-client";
import * as profileTokenApi from "@/features/profile/model/profile-planning-items-api";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { taskUpdateRequestPayload } from "@/features/tasks/model/task-mutation-contract";
import { createPlanningState } from "./planning-state-owner";
import { sprintNumber } from "@/lib/planning-schedule";
import { normalizePlanningShellState } from "../planning-app-model";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { isSupportingWorkspace, supportingWorkspaceModelToPlanningShellState } from "../supporting-planning-shell-projection";
import { sprintModelCoverage } from "./sprint-read-coverage";
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
  const runtime = { apiClient: createBrowserApiClient(), workspace: options.initialWorkspace, userId: options.initialUserId, session: null as BrowserSessionSnapshot | null, currentProfile: options.initialCurrentProfile };
  const owner = createPlanningState({
    userId: options.initialUserId,
    initialData: options.initialData,
    initialWorkspace: options.initialWorkspace,
    initialHeaderData: options.initialHeaderData,
    adapter: {
      async lockSprint(basis) {
        const {response,body}=await planningApi.lockSprintRequest(runtime.apiClient,basis.sprint.id,{expectedUpdatedAt:basis.sprint.updatedAt,expectedTasks:basis.tasks.map(task=>({id:task.id,updatedAt:task.updatedAt}))});
        if(!response.ok)throw Object.assign(new Error(body?.error||"Sprint-Abschluss fehlgeschlagen."),{status:response.status,code:body?.code});
        if(!body?.sprint||body.sprint.id!==basis.sprint.id||!body.sprint.scoreLocked||body.sprint.status!=="closed")throw new Error("Sprint-Abschluss ist noch nicht bestätigt.");
        return {...body,sprint:body.sprint};
      },
      async readSprintLock(sprintId) {
        const {response,body}=await planningApi.requestSprintLock(runtime.apiClient,sprintId);
        if(!response.ok)throw Object.assign(new Error(body?.error||"Abschlussstand nicht verfügbar."),{status:response.status,code:body?.code});
        if(!body?.basis?.sprint?.updatedAt||!Array.isArray(body.basis.tasks)||typeof body.tasksComplete!=="boolean")throw new Error("Abschlussstand ist unvollständig.");
        return {basis:body.basis,tasksComplete:body.tasksComplete,receipt:body.receipt||null};
      },
      readPrivateWorkweek: week => privateWorkweekApi(runtime.apiClient).readPrivateWorkweek(week),
      savePrivateWorkweek: input => privateWorkweekApi(runtime.apiClient).savePrivateWorkweek(input),
      publishPrivateWorkweek: versionId => privateWorkweekApi(runtime.apiClient).publishPrivateWorkweek(versionId),
      async assignBacklog(tasks, target, bulk) {
        if (bulk && target) {
          const { response, body } = await taskApi.assignBacklogTasksToSprintRequest(runtime.apiClient, { assignments: tasks.map(task => ({ taskId: task.id, expectedUpdatedAt: task.updatedAt! })), sprintId: target.id, expectedSprintUpdatedAt: target.updatedAt });
          if (!response.ok) throw Object.assign(new Error(body?.error || "Sprint-Zuordnung ist nicht bestätigt."), { status: response.status, code: body?.code });
          if (!Array.isArray(body?.updates)) throw new Error("Sprint-Zuordnung ist nicht vollständig bestätigt.");
          return { updates: body.updates };
        }
        const task = tasks[0];
        const { response, body } = await taskApi.updateTaskRequest(runtime.apiClient, task.id, { ...taskUpdateRequestPayload({ sprintId: target?.id || "" }, task.updatedAt || ""), ...(target ? { expectedSprintUpdatedAt: target.updatedAt } : {}) });
        if (!response.ok) throw Object.assign(new Error(body?.error || "Sprint-Zuordnung ist nicht bestätigt."), { status: response.status, code: body?.code, kind: body?.conflictReason === "revision" ? "versionConflict" : undefined });
        if (!body?.task) throw new Error("Sprint-Zuordnung ist noch nicht bestätigt.");
        return { updates: [{ ...body.task, id: task.id }], activities: body.activities };

      },
      async createSprintPlan(input, basis) {
        const { response, body } = await planningApi.createSprintPlanRequest(runtime.apiClient, { ...input, expectedSprints: basis.sprints.map(sprint => ({ id: sprint.id, number: Math.max(sprintNumber(sprint.name), sprintNumber(sprint.id)), updatedAt: sprint.updatedAt })) });
        if (!response.ok) throw Object.assign(new Error(body?.error || "Sprint-Plan konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        if (!Array.isArray(body?.sprints)) throw new Error("Die Planung ist noch nicht bestätigt.");
        return { sprints: body.sprints };
      },
      readWorkweekCalendar: scope => readPublishedWorkweekCalendar(runtime.apiClient, scope),
      async saveReviewWindow(expectedHours, hours) {
        const { response, body } = await planningApi.updateSprintReviewWindowRequest(runtime.apiClient, expectedHours, hours);
        if (!response.ok) throw Object.assign(new Error(body?.error || "Prozesseinstellung konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        if (!body?.project || !Array.isArray(body.sprints)) throw new Error("Die Speicherung ist noch nicht bestätigt.");
        return { project: body.project, sprints: body.sprints };
      },
      async saveSprint(sprint, patch) {
        const { response, body } = await planningApi.updateSprintRequest(runtime.apiClient, sprint.id, { ...patch, expectedUpdatedAt: sprint.updatedAt });
        if (!response.ok) throw Object.assign(new Error(body?.error || "Sprint konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        if (!body?.sprint?.updatedAt) throw new Error("Die Speicherung ist noch nicht bestätigt.");
        return { sprint: body.sprint };
      },
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
      async readTools() {
        const { response, body } = await planningApi.requestSupportingWorkspaceData(runtime.apiClient, "tools");
        if (!response.ok || !body?.model) throw Object.assign(new Error(body?.error || "Links konnten nicht geladen werden."), { status: response.status });
        const model = body.model as import("@/features/tools/model/tools-read-model").ToolsWorkspaceModel;
        return { tools: model.tools, completeness: model.coverage || "partial", headerData: body.headerData ? normalizePlanningHeaderData(body.headerData) : undefined };
      },
      async createTool(draft) {
        const { response, body } = await planningApi.createFmdToolRequest(runtime.apiClient, draft);
        if (!response.ok || !body?.tool) throw Object.assign(new Error(body?.error || "Link konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        return { tool: body.tool, warning: body.warning };
      },
      async updateTool(basis, draft) {
        const { response, body } = await planningApi.updateFmdToolRequest(runtime.apiClient, basis.id, { ...draft, expectedUpdatedAt: basis.updatedAt });
        if (!response.ok || !body?.tool) throw Object.assign(new Error(body?.error || "Link konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        return { tool: body.tool, warning: body.warning };
      },
      async uploadToolPreview(file) {
        const { response, body } = await planningApi.uploadFmdToolPreviewImageRequest(runtime.apiClient, file);
        if (!response.ok || !body?.imageUrl || body.source !== "manual") throw Object.assign(new Error(body?.error || "Bild-Upload ist noch nicht bestätigt."), { status: response.status, code: body?.code });
        return { imageUrl: body.imageUrl, source: body.source };
      },
      async readToolPreview(imageUrl) {
        if (!isProtectedToolPreviewUrl(imageUrl)) throw new Error("Der Bildpfad ist nicht verfügbar.");
        const { response } = await runtime.apiClient.requestBlob(imageUrl);
        if (!response.ok) throw Object.assign(new Error("Das Vorschaubild konnte nicht geprüft werden."), { status: response.status });
        return true;
      },
      async readEvents(range) {
        const query = range ? `?${new URLSearchParams(range)}` : "";
        const { response, body } = await runtime.apiClient.requestJson<{ model?: import("@/features/events/model/events-read-model").EventsWorkspaceModel; headerData?: PlanningHeaderData; error?: string }>(`/api/events-data${query}`);
        if (!response.ok || !body?.model) throw Object.assign(new Error(body?.error || "Events konnten nicht geladen werden."), { status: response.status });
        return { events: body.model.events, coverage: body.model.coverage || { range, completeness: "partial" }, headerData: body.headerData ? normalizePlanningHeaderData(body.headerData) : undefined };
      },
      async createEvent(draft) {
        const { response, body } = await planningApi.createFounderEventRequest(runtime.apiClient, draft);
        if (!response.ok || !body?.event) throw Object.assign(new Error(body?.error || "Event konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        return { event: body.event, warning: body.warning };
      },
      async updateEvent(basis, draft) {
        const { response, body } = await planningApi.updateFounderEventRequest(runtime.apiClient, basis.id, { ...draft, expectedUpdatedAt: basis.updatedAt });
        if (!response.ok || !body?.event) throw Object.assign(new Error(body?.error || "Event konnte nicht aktualisiert werden."), { status: response.status, code: body?.code });
        return { event: body.event, warning: body.warning };
      },
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
      async saveTeamProfile(profileId, patch, expected) {
        const { response, body } = await planningApi.updateProfileRequest(runtime.apiClient, profileId, { ...patch, expected });
        if (!response.ok || body?.profile?.id !== profileId) throw Object.assign(new Error(body?.error || "Profil konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        return { ...body.profile, id: profileId };
      },
      async saveOwnProfileSettings(patch) {
        const { response, body } = await planningApi.updateOwnProfileSettingsRequest(runtime.apiClient, { ...patch.profilePatch, expected: patch.expected, profileColorDuplicateMode: patch.profileColorDuplicateMode, notificationEvents: patch.notificationEvents, uiPreferences: patch.uiPreferences });
        if (!response.ok || !body?.profile) throw Object.assign(new Error(body?.error || "Profil konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        return { profile: body.profile, uiPreference: body.uiPreference, notificationPreferences: body.notificationPreferences || [] };
      },
      async acknowledgeFeatureTour(tourId) {
        const { response, body } = await planningApi.markProfileFeatureTourSeenRequest(runtime.apiClient, tourId);
        if (!response.ok || !body?.acknowledgement) throw Object.assign(new Error(body?.error || "Die Bestätigung der Hilfe-Tour steht noch aus."), { status: response.status, code: body?.code });
        return body.acknowledgement;
      },
      async readProfileApiTokens() {
        const { response, body } = await profileTokenApi.loadPlanningItemsTokens(runtime.apiClient);
        if (!response.ok || !body?.tokens) throw Object.assign(new Error(body?.error || "Planning-API-Tokens konnten nicht geladen werden."), { status: response.status, code: body?.code });
        return { tokens: body.tokens, canIssueEmptyEpicDeletes: Boolean(body.capabilities?.canIssueEmptyEpicDeletes) };
      },
      async issueProfileApiToken(draft) {
        const { response, body } = await profileTokenApi.createPlanningItemsToken(runtime.apiClient, draft.label, draft.allowUpdates, draft.allowEmptyEpicDeletes, draft.allowGitHubSync);
        if (!response.ok || !body?.token || !body.tokenRecord) throw Object.assign(new Error(body?.error || "Planning-API-Token konnte nicht erstellt werden."), { status: response.status, code: body?.code });
        return { token: body.token, tokenRecord: body.tokenRecord };
      },
      async revokeProfileApiToken(tokenId) {
        const { response, body } = await profileTokenApi.revokePlanningItemsToken(runtime.apiClient, tokenId);
        if (!response.ok || !body?.ok) throw Object.assign(new Error(body?.error || "Planning-API-Token konnte nicht widerrufen werden."), { status: response.status, code: body?.code });
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
        if (workspace === "backlog") {
          const { response, body } = await requestBacklogModel(runtime.apiClient);
          if (!response.ok || !body?.model) throw Object.assign(new Error(body?.error || "Backlog konnte nicht geladen werden."), { status: response.status });
          return { data: backlogModelToPlanningShellState(body.model), coverage: backlogModelCoverage(body.model), taskCoverage: body.model.coverage?.items || "partial", taskOmittedFields: backlogOmittedFields(body.model), backlogCoverage: body.model.coverage };
        }
        if (isSupportingWorkspace(workspace)) {
          const { response, body } = await planningApi.requestSupportingWorkspaceData(runtime.apiClient, workspace);
          if (!response.ok) throw Object.assign(new Error(body?.error || "Planungsdaten konnten nicht geladen werden."), { status: response.status });
          return body?.model ? { data: normalizePlanningShellState(supportingWorkspaceModelToPlanningShellState(workspace, body.model)), toolCoverage: workspace === "tools" ? (body.model as import("@/features/tools/model/tools-read-model").ToolsWorkspaceModel).coverage : undefined, eventCoverage: workspace === "events" ? (body.model as import("@/features/events/model/events-read-model").EventsWorkspaceModel).coverage : undefined, notificationCoverage: workspace === "notifications" ? (body.model as import("@/features/notifications/model/notifications-read-model").NotificationsWorkspaceModel).coverage : undefined, taskCoverage: (workspace === "team" || workspace === "profile" || workspace === "notifications" ? "partial" : "none") as "partial" | "none", headerData: body.headerData, currentProfile: body.currentProfile } : null;
        }
        if (workspace === "sprint") {
          const { response, body } = await planningApi.requestSprintWorkspaceData(runtime.apiClient);
          if (!response.ok) throw Object.assign(new Error(body?.error || "Planungsdaten konnten nicht geladen werden."), { status: response.status });
          return body?.model ? { data: normalizePlanningShellState(sprintWorkspaceModelToPlanningShellState(body.model)), coverage: sprintModelCoverage(body.model), headerData: body.headerData, currentProfile: body.currentProfile } : null;
        }
        return null;
      },
    },
    acceptWorkspaceContext(result) {
      if (!isCurrent()) return;
      const profileId = result.currentProfile?.id || runtime.currentProfile?.id;
      runtime.currentProfile = owner.planning.protectedCache()?.profiles.find(profile => profile.id === profileId) || null;
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
        currentProfile: data.profiles.find(profile => profile.id === runtime.currentProfile?.id) || null,
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
    acceptProtectedData(data: PlanningShellState, account: string, workspace: AppWorkspace = runtime.workspace) {
      if (!isCurrent() || account !== runtime.userId) return;
      owner.internal.acceptHydration(data, account, workspace);
    },
  };

}

export type BrowserPlanningState = ReturnType<typeof createBrowserPlanningState>;
