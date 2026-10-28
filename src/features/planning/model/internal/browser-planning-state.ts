"use client";

import { classifyTaskGitHubSyncResponse } from "@/lib/github-sync/contract";
import { githubUserConnectionStateFromStatus } from "../github-app-connection";
import { sessionAuthority } from "@/features/administrator-access/model/administrator-access";

import { googleWorkspaceApi } from "@/features/team-workweek/model/google-workspace-api";
import { privateWorkweekApi } from "@/features/team-workweek/model/private-workweek-api";
import { requestBacklogModel } from "@/features/backlog/model/backlog-api-client";
import { backlogModelToPlanningShellState } from "@/features/backlog/model/backlog-planning-shell-projection";
import { supportingReadCoverage, supportingOmittedFields } from "./supporting-read-coverage";
import { hierarchyReadCoverage, hierarchyOmittedFields } from "./hierarchy-read-coverage";
import { backlogModelCoverage, backlogOmittedFields } from "./backlog-read-coverage";
import { readPublishedWorkweekCalendar } from "@/features/team-workweek/model/published-workweek-calendar-api";

import { isProtectedToolPreviewUrl } from "@/lib/tool-preview-image";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { createBrowserApiClient } from "@/lib/browser-api-client";
import { createBrowserSessionAdapter, type BrowserSessionSnapshot } from "@/lib/credentials/browser";
import type { AuthenticatedProfile, PlanningHeaderData, PlanningShellState } from "@/lib/types";
import * as planningApi from "../planning-api-client";
import * as profileTokenApi from "@/features/profile/model/profile-planning-items-api";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { taskUpdateRequestPayload } from "@/features/tasks/model/task-mutation-contract";
import { createPlanningState } from "./planning-state-owner";
import { mapScoreObjection, mapFounderSprintScore } from "@/lib/planning-sprint-mappers";
import type { DbScoreObjection, DbFounderSprintScore } from "@/lib/planning-row-types";
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
  initialDecisionLogResult?: import("@/lib/notion-decision-log").NotionDecisionLogResult;
  initialAdministratorAccess?: import("@/features/administrator-access/model/administrator-access").AdministratorAccessSnapshot;
};

export function createBrowserPlanningState(options: PlanningPageState, isCurrent: () => boolean = () => true) {
  const runtime = { apiClient: createBrowserApiClient(), workspace: options.initialWorkspace, userId: options.initialUserId, session: null as BrowserSessionSnapshot | null, currentProfile: options.initialCurrentProfile };
  async function currentOperationSession() {
    const session = runtime.session || await createBrowserSessionAdapter().current();
    if (!session || session.expiresAt * 1000 <= Date.now()) throw Object.assign(new Error("Für diese Aktion ist eine aktive Sitzung erforderlich."), { status: 401 });
    if (!isCurrent() || session.userId !== runtime.userId) throw Object.assign(new Error("Die Sitzung wurde ersetzt."), { code: "session_superseded" });
    runtime.session = session;
    return session;
  }
  async function dispatchBinding(existing?: NonNullable<Parameters<BrowserApiClient["requestJson"]>[1]>["expectedSession"]) {
    const session = await currentOperationSession();
    return { userId: existing?.userId || session.userId, revision: existing?.revision || session.revision, isCurrent: () => isCurrent() && owner.internal.isActive() && Boolean(runtime.session && runtime.session.userId === session.userId && runtime.session.expiresAt * 1000 > Date.now()) && existing?.isCurrent?.() !== false };
  }
  async function administrationBinding() {
    const guard = owner.internal.captureAdministrationDispatchGuard();
    const session = await currentOperationSession();
    return { userId: session.userId, revision: session.revision, isCurrent: guard };
  }
  const ownedApiClient: BrowserApiClient = {
    async requestJson<T>(input: Parameters<BrowserApiClient["requestJson"]>[0], requestOptions?: Parameters<BrowserApiClient["requestJson"]>[1]) {
      const binding = await dispatchBinding(requestOptions?.expectedSession);
      const result = await runtime.apiClient.requestJson<T>(input, { ...requestOptions, expectedSession: binding });
      if ((result.body as { code?: string } | null)?.code === "session_superseded") {
        if (isCurrent() && owner.internal.isActive() && requestOptions?.expectedSession?.isCurrent?.() === false) throw Object.assign(new Error("Die zeitlich begrenzte Berechtigung wurde beendet."), { status: 403, code: "administrator_access_expired" });
        owner.internal.endSession();
        throw Object.assign(new Error("Die Sitzung wurde ersetzt."), { status: 409, code: "session_superseded" });
      }
      return result;
    },
    async requestForm<T>(input: Parameters<BrowserApiClient["requestForm"]>[0], formData: FormData, requestOptions?: Parameters<BrowserApiClient["requestForm"]>[2]) {
      const binding = await dispatchBinding(requestOptions?.expectedSession);
      const result = await runtime.apiClient.requestForm<T>(input, formData, { ...requestOptions, expectedSession: binding });
      if ((result.body as { code?: string } | null)?.code === "session_superseded") {
        owner.internal.endSession();
        throw Object.assign(new Error("Die Sitzung wurde ersetzt."), { status: 409, code: "session_superseded" });
      }
      return result;
    },
    async requestBlob(input, requestOptions) {
      const binding = await dispatchBinding(requestOptions?.expectedSession);
      const result = await runtime.apiClient.requestBlob(input, { ...requestOptions, expectedSession: binding });
      if (result.response.status === 409 && !binding.isCurrent()) owner.internal.endSession();
      return result;
    },
  };
  const owner = createPlanningState({
    userId: options.initialUserId,
    initialData: options.initialData,
    initialWorkspace: options.initialWorkspace,
    initialHeaderData: options.initialHeaderData,
    initialCurrentProfile: options.initialCurrentProfile,
    initialDecisionLogResult: options.initialDecisionLogResult,
    administrationActorProfileId: options.initialCurrentProfile?.id,
    initialAdministrationAuthority: options.initialAdministratorAccess ? sessionAuthority({ platformRole: options.initialCurrentProfile?.platformRole || "viewer", credentialKind: "session", administratorAccess: options.initialAdministratorAccess }) : undefined,
    adapter: {
      async readDecisionLog() {
        const {response,body}=await ownedApiClient.requestJson<{result?: import("@/lib/notion-decision-log").NotionDecisionLogResult;error?:string}>("/api/decision-log",{useDevProfileOverride:false});
        if(!response.ok || !body?.result) throw Object.assign(new Error(body?.error||"Decision Log konnte nicht geladen werden."),{status:response.status});
        return body.result;
      },
      async readMeetingAttendance(meetingId, profileId) {
        const {response,body}=await ownedApiClient.requestJson<{attendance?: import("@/lib/types").MeetingAttendance|null;error?:string;code?:string}>(`/api/meetings/${meetingId}/attendance?profileId=${encodeURIComponent(profileId)}`);
        if(!response.ok||!body||!("attendance" in body))throw Object.assign(new Error(body?.error||"Weekly-Rückmeldung konnte nicht geprüft werden."),{status:response.status,code:body?.code});
        return {attendance:body.attendance ?? null};
      },
      async saveMeetingAttendance(meeting,basis,input) {
        const {response,body}=await planningApi.updateMeetingAttendanceRequest(ownedApiClient,meeting.id,{profileId:input.profileId,status:input.status,absenceReason:input.absenceReason,reasonAccepted:input.reasonAccepted,writtenUpdate:input.writtenUpdate,points:input.points,expectedUpdatedAt:basis?.updatedAt ?? null});
        if(!response.ok||!body?.attendance)throw Object.assign(new Error(body?.error||"Weekly-Rückmeldung konnte nicht gespeichert werden."),{status:response.status,code:body?.code});
        return {attendance:body.attendance,effects:body.effects||"unconfirmed",warning:body.warning};
      },
      async syncTaskGitHub(taskId,command) {
        const session=await currentOperationSession();
        const {response,body}=await taskApi.syncTaskToGitHubRequest(ownedApiClient,taskId,command,{expectedSession:{userId:session.userId,revision:session.revision}});
        const failure=body as {code?:string;error?:string}|null;
        if(failure?.code==="session_superseded")throw Object.assign(new Error(failure.error||"Die Sitzung wurde ersetzt."),{code:failure.code,status:response.status});
        if(!body || typeof body.ok!=="boolean" || !body.ok && (typeof body.code!=="string" || !body.code.startsWith("github_sync_") && body.code!=="github_content_too_long")) {
          if(response.status>=500||response.ok)throw new Error("Die GitHub-Synchronisierung ist noch nicht bestätigt.");
          return classifyTaskGitHubSyncResponse(response.status,null);
        }
        return classifyTaskGitHubSyncResponse(response.status,body);
      },
      async readGitHubConnection() {
        const session=await currentOperationSession();
        const {response,body}=await ownedApiClient.requestJson<{installation?:{available?:boolean};user?:{connected?:boolean;needsReconnect?:boolean};waitingCommentCount?:number|null;error?:string;code?:string}>("/api/github-app/status",{expectedSession:{userId:session.userId,revision:session.revision}});
        if(!response.ok||typeof body?.installation?.available!=="boolean"||!body.user)throw Object.assign(new Error(body?.error||"GitHub-Verbindungsstatus ist nicht verfügbar."),{status:response.status,code:body?.code});
        const state=githubUserConnectionStateFromStatus(body.user);
        return {installationAvailable:body.installation.available,userConnected:state==="connected",state,waitingCommentCount:typeof body.waitingCommentCount==="number"?body.waitingCommentCount:null};
      },
      async executeAdministrationDelivery(selection) {
        const payload=selection.kind==="events"?{eventIds:[...selection.eventIds]}:selection.kind==="pending"?{limit:selection.limit}:selection.kind==="webhook-test"?{testDelivery:"webhook_digest"}:{testDelivery:"direct_dm",profileId:selection.profileId};
        const {response,body}=await ownedApiClient.requestJson<Omit<import("@/features/administration/model/administration-delivery-state").AdministrationDeliveryResponse,"ok"|"status">>("/api/notifications/deliver",{method:"POST",json:payload,useDevProfileOverride:false,expectedSession:await administrationBinding()});
        return {...body,ok:response.ok,status:response.status};
      },
      async saveAdministrationProject(project,expected) {
        const {response,body}=await ownedApiClient.requestJson<{ok?:boolean;project?:{id:string;githubProjectOwner:string;githubProjectNumber:number;githubMentionTeamSlug:string};error?:string;code?:string}>("/api/founderops-settings/github-project",{method:"PATCH",json:{expectedGithubProjectOwner:expected.owner,expectedGithubProjectNumber:expected.number,expectedGithubMentionTeamSlug:expected.mentionTeamSlug,githubProjectOwner:project.owner,githubProjectNumber:project.number,githubMentionTeamSlug:project.mentionTeamSlug},useDevProfileOverride:false,expectedSession:await administrationBinding()});
        if(!response.ok)throw Object.assign(new Error(body?.error||"GitHub Project konnte nicht gespeichert werden."),{status:response.status,code:body?.code});
        if(!body?.ok||!body.project)throw new Error("Die GitHub-Project-Speicherung ist noch nicht bestätigt.");
        return {project:{id:body.project.id,owner:body.project.githubProjectOwner,number:body.project.githubProjectNumber,mentionTeamSlug:body.project.githubMentionTeamSlug}};
      },
      async readAdministration() {
        const {response,body}=await ownedApiClient.requestJson<{administration?:import("@/features/administration/model/administration-read-model").AdministrationWorkspaceModel;error?:string;code?:string}>("/api/administration-data",{useDevProfileOverride:false,expectedSession:await administrationBinding()});
        if(!response.ok||!body?.administration)throw Object.assign(new Error(body?.error||"Administrationsdaten konnten nicht geladen werden."),{status:response.status,code:body?.code});
        return body.administration;
      },
      async saveAdministrationTechnical(profileId,patch,expected) {
        const {response,body}=await ownedApiClient.requestJson<{ok?:boolean;profile?:{id:string}&import("@/features/administration/model/administration-read-model").TechnicalIdentityBasis;error?:string;code?:string}>(`/api/administration/profiles/${encodeURIComponent(profileId)}/technical`,{method:"PATCH",json:{...patch,expected},useDevProfileOverride:false,expectedSession:await administrationBinding()});
        if(!response.ok)throw Object.assign(new Error(body?.error||"Technische Identität konnte nicht gespeichert werden."),{status:response.status,code:body?.code});
        if(!body?.ok)throw new Error("Die technische Speicherung ist noch nicht bestätigt.");return{profile:body.profile};
      },
      async saveAdministrationEligibility(profileId,eligible,expectedEligible) {
        const {response,body}=await ownedApiClient.requestJson<{administratorAccess?:import("@/features/administrator-access/model/administrator-access").AdministratorAccessSnapshot&{profileId:string};error?:string;code?:string}>(`/api/administrator-access/profiles/${encodeURIComponent(profileId)}`,{method:"PATCH",json:{eligible,expectedEligible},useDevProfileOverride:false,expectedSession:await administrationBinding()});
        if(!response.ok)throw Object.assign(new Error(body?.error||"Adminberechtigung konnte nicht gespeichert werden."),{status:response.status,code:body?.code});
        if(!body?.administratorAccess)throw new Error("Die Adminberechtigung ist noch nicht bestätigt.");return body.administratorAccess;
      },
      async addTaskRelationship(task, input) {
        const { response, body } = await taskApi.addTaskRelationshipRequest(ownedApiClient, task.id, { ...input, expectedUpdatedAt: task.updatedAt });
        if (!response.ok) throw Object.assign(new Error(body?.error || "Abhängigkeit konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        if (!body?.relation) throw new Error("Die Beziehungsbestätigung ist unvollständig.");
        return { relation: body.relation };
      },
      async removeTaskRelationship(task, relation) {
        const { response, body } = await taskApi.removeTaskRelationshipRequest(ownedApiClient, task.id, relation.id, task.updatedAt);
        if (!response.ok) throw Object.assign(new Error(body?.error || "Abhängigkeit konnte nicht entfernt werden."), { status: response.status, code: body?.code });
        if (!Number.isSafeInteger(body?.relationId)) throw new Error("Die Entfernung ist noch nicht bestätigt.");
        return { relationId: body!.relationId! };
      },
      async uploadTaskAttachment(taskId, file) {
        const session = await currentOperationSession();
        const { response, body } = await taskApi.uploadTaskAttachmentRequest(ownedApiClient, taskId, file, { userId: session.userId, sessionRevision: session.revision, isCurrent: () => isCurrent() && runtime.session?.userId === session.userId && runtime.session?.revision === session.revision });
        if (!response.ok) throw Object.assign(new Error(body?.error || "Anhang konnte nicht hochgeladen werden."), { status: response.status, code: body?.code });
        if (!body?.markdown || !body.path || !body.url || !body.filename || !body.contentType || typeof body.size !== "number") throw new Error("Die Upload-Bestätigung ist unvollständig.");
        return { filename: body.filename, contentType: body.contentType, size: body.size, markdown: body.markdown, path: body.path, url: body.url, htmlUrl: body.htmlUrl || "", activity: body.activity || null, effects: body.effects === "confirmed" ? "confirmed" : "unconfirmed", warning: body.warning };
      },
      async decideTaskApproval(task,action,note) {
        const {response,body}=await taskApi.decideTaskApprovalRequest(ownedApiClient,task.id,action,task.approvalRevision,note);
        if(!response.ok)throw Object.assign(new Error(body?.error||"Freigabeentscheidung konnte nicht gespeichert werden."),{status:response.status,code:body?.code,kind:body?.conflictReason==="revision"?"versionConflict":undefined});
        if(!body?.task)throw new Error("Die Freigabeentscheidung ist noch nicht bestätigt.");return {task:body.task};
      },
      async requestTaskReview(task,input) {
        const {response,body}=await taskApi.updateTaskRequest(ownedApiClient,task.id,taskUpdateRequestPayload({...input,status:"Review",reviewStatus:"requested",scoreFinal:false},task.updatedAt||""));
        if(!response.ok)throw Object.assign(new Error(body?.error||"Review konnte nicht angefragt werden."),{status:response.status,code:body?.code,kind:body?.conflictReason==="revision"?"versionConflict":undefined});
        if(!body?.task)throw new Error("Die Review-Anfrage ist noch nicht bestätigt.");return {task:body.task,activities:body.activities};
      },
      async decideTaskReview(task,input) {
        const {response,body}=await taskApi.reviewTaskRequest(ownedApiClient,task.id,{...input,expectedUpdatedAt:task.updatedAt});
        if(!response.ok)throw Object.assign(new Error(body?.error||"Review konnte nicht gespeichert werden."),{status:response.status,code:body?.code,kind:body?.conflictReason==="revision"?"versionConflict":undefined});
        if(!body?.task||!body.review)throw new Error("Die Review-Entscheidung ist noch nicht bestätigt.");return {task:body.task,review:body.review,activities:body.activities};
      },
      async withdrawTaskReview(task,reason) {
        const {response,body}=await taskApi.withdrawTaskReviewRequest(ownedApiClient,task.id,reason,task.updatedAt||"");
        if(!response.ok)throw Object.assign(new Error(body?.error||"Review konnte nicht zurückgezogen werden."),{status:response.status,code:body?.code,kind:body?.conflictReason==="revision"?"versionConflict":undefined});
        if(!body?.task)throw new Error("Das Zurückziehen ist noch nicht bestätigt.");return {task:body.task,activities:body.activities};
      },
      async reopenTaskReview(task,input) {
        const {response,body}=await taskApi.reopenTaskReviewRequest(ownedApiClient,task.id,task.updatedAt||"",input);
        if(!response.ok)throw Object.assign(new Error(body?.error||"Review konnte nicht erneut geöffnet werden."),{status:response.status,code:body?.code,kind:body?.conflictReason==="revision"?"versionConflict":undefined});
        if(!body?.task)throw new Error("Das erneute Öffnen ist noch nicht bestätigt.");return {task:body.task,activities:body.activities};
      },
      async importTaskGitHubComments(taskId) {
        const { response, body } = await taskApi.importGitHubCommentsRequest(ownedApiClient, taskId);
        if (!response.ok) throw Object.assign(new Error(body?.error || "GitHub-Kommentare konnten nicht aktualisiert werden."), { status: response.status, code: body?.code });
        if (!Array.isArray(body?.comments) || typeof body.evidenceLink !== "string" || typeof body.imported !== "number") throw new Error("Die Importbestätigung ist unvollständig.");
        return { comments: body.comments, commentsCoverage: body.commentsCoverage === "complete" ? "complete" : "partial", evidenceLink: body.evidenceLink, imported: body.imported };
      },
      async createTaskComment(taskId, submitted) {
        const { response, body } = await taskApi.createTaskCommentRequest(ownedApiClient, taskId, submitted);
        if (!response.ok) throw Object.assign(new Error(body?.error || "Kommentar konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        if (!body?.comment) throw new Error("Die Kommentarbestätigung ist unvollständig.");
        return { comment: body.comment, notice: body.notice };
      },
      async reportBlocker(taskId, submitted) {
        const { response, body } = await taskApi.reportTaskBlockerRequest(ownedApiClient, taskId, submitted);
        if (!response.ok) throw Object.assign(new Error(body?.error || "Blocker konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        if (!body?.blocker) throw new Error("Die Blocker-Meldung ist noch nicht bestätigt.");
        return { blocker: body.blocker };
      },
      async createScoreObjection(sprintId, comment) {
        const {response,body}=await ownedApiClient.requestJson<{objection?:DbScoreObjection;error?:string;code?:string}>(`/api/sprints/${sprintId}/score-objections`,{method:"POST",json:{comment},useDevProfileOverride:false});
        if(!response.ok)throw Object.assign(new Error(body?.error||"Einwand konnte nicht gespeichert werden."),{status:response.status,code:body?.code});
        if(!body?.objection)throw new Error("Der Einwand ist noch nicht bestätigt.");
        return {objection:mapScoreObjection(body.objection)};
      },
      async processScoreObjection(objection,score,input) {
        if(!objection.persistenceBasis || input.action==="resolve"&&input.status==="accepted"&&score&&!score.persistenceBasis)throw Object.assign(new Error("Die ursprüngliche Entscheidungsgrundlage fehlt. Bitte neu laden."),{status:400});
        const {response,body}=await ownedApiClient.requestJson<{objection?:DbScoreObjection;score?:DbFounderSprintScore|null;error?:string;code?:string}>(`/api/sprints/${objection.sprintId}/score-objections`,{method:"PATCH",json:{...input,objectionId:objection.id,expectedObjection:objection.persistenceBasis,expectedScore:score?.persistenceBasis||null},useDevProfileOverride:false});
        if(!response.ok)throw Object.assign(new Error(body?.error||"Einwand konnte nicht geprüft werden."),{status:response.status,code:body?.code});
        if(!body?.objection)throw new Error("Die Entscheidung ist noch nicht bestätigt.");
        return {objection:mapScoreObjection(body.objection),score:body.score?mapFounderSprintScore(body.score):null};
      },
      async lockSprint(basis) {
        const {response,body}=await planningApi.lockSprintRequest(ownedApiClient,basis.sprint.id,{expectedUpdatedAt:basis.sprint.updatedAt,expectedTasks:basis.tasks.map(task=>({id:task.id,updatedAt:task.updatedAt}))});
        if(!response.ok)throw Object.assign(new Error(body?.error||"Sprint-Abschluss fehlgeschlagen."),{status:response.status,code:body?.code});
        if(!body?.sprint||body.sprint.id!==basis.sprint.id||!body.sprint.scoreLocked||body.sprint.status!=="closed")throw new Error("Sprint-Abschluss ist noch nicht bestätigt.");
        return {...body,sprint:body.sprint};
      },
      async readSprintLock(sprintId) {
        const {response,body}=await planningApi.requestSprintLock(ownedApiClient,sprintId);
        if(!response.ok)throw Object.assign(new Error(body?.error||"Abschlussstand nicht verfügbar."),{status:response.status,code:body?.code});
        if(!body?.basis?.sprint?.updatedAt||!Array.isArray(body.basis.tasks)||typeof body.tasksComplete!=="boolean")throw new Error("Abschlussstand ist unvollständig.");
        return {basis:body.basis,tasksComplete:body.tasksComplete,receipt:body.receipt||null};
      },
      readGoogleWorkspace: () => googleWorkspaceApi(ownedApiClient).readGoogleWorkspace(),
      readGoogleDisconnect: () => googleWorkspaceApi(ownedApiClient).readGoogleDisconnect(),
      disconnectGoogleWorkspace: () => googleWorkspaceApi(ownedApiClient).disconnectGoogleWorkspace(),
      restartPrivateWorkweek: versionId => privateWorkweekApi(ownedApiClient).restartPrivateWorkweek(versionId),
      readWorkweekConflict: () => privateWorkweekApi(ownedApiClient).readWorkweekConflict(),
      resolveWorkweekConflict: input => privateWorkweekApi(ownedApiClient).resolveWorkweekConflict(input),
      reconcilePrivateWorkweek: () => privateWorkweekApi(ownedApiClient).reconcilePrivateWorkweek(),
      readPrivateWorkweek: week => privateWorkweekApi(ownedApiClient).readPrivateWorkweek(week),
      savePrivateWorkweek: input => privateWorkweekApi(ownedApiClient).savePrivateWorkweek(input),
      publishPrivateWorkweek: versionId => privateWorkweekApi(ownedApiClient).publishPrivateWorkweek(versionId),
      async moveBacklog(source, target, placement) {
        const { response, body } = await taskApi.moveBacklogTaskRequest(ownedApiClient, { taskId: source.id, targetTaskId: target.id, placement, expectedTaskUpdatedAt: source.updatedAt!, expectedTargetUpdatedAt: target.updatedAt! });
        if (!response.ok) throw Object.assign(new Error(body?.error || "Die Rangfolge ist nicht bestätigt."), { status: response.status, code: body?.code });
        if (!Array.isArray(body?.updates)) throw new Error("Das Rangergebnis ist nicht bestätigt.");
        return { updates: body.updates, completeness: body.completeness === "complete" ? "complete" : "partial" };
      },
      async assignBacklog(tasks, target, bulk) {
        if (bulk && target) {
          const { response, body } = await taskApi.assignBacklogTasksToSprintRequest(ownedApiClient, { assignments: tasks.map(task => ({ taskId: task.id, expectedUpdatedAt: task.updatedAt! })), sprintId: target.id, expectedSprintUpdatedAt: target.updatedAt });
          if (!response.ok) throw Object.assign(new Error(body?.error || "Sprint-Zuordnung ist nicht bestätigt."), { status: response.status, code: body?.code });
          if (!Array.isArray(body?.updates)) throw new Error("Sprint-Zuordnung ist nicht vollständig bestätigt.");
          return { updates: body.updates };
        }
        const task = tasks[0];
        const { response, body } = await taskApi.updateTaskRequest(ownedApiClient, task.id, { ...taskUpdateRequestPayload({ sprintId: target?.id || "" }, task.updatedAt || ""), ...(target ? { expectedSprintUpdatedAt: target.updatedAt } : {}) });
        if (!response.ok) throw Object.assign(new Error(body?.error || "Sprint-Zuordnung ist nicht bestätigt."), { status: response.status, code: body?.code, kind: body?.conflictReason === "revision" ? "versionConflict" : undefined });
        if (!body?.task) throw new Error("Sprint-Zuordnung ist noch nicht bestätigt.");
        return { updates: [{ ...body.task, id: task.id }], activities: body.activities };

      },
      async createSprintPlan(input, basis) {
        const { response, body } = await planningApi.createSprintPlanRequest(ownedApiClient, { ...input, expectedSprints: basis.sprints.map(sprint => ({ id: sprint.id, number: Math.max(sprintNumber(sprint.name), sprintNumber(sprint.id)), updatedAt: sprint.updatedAt })) });
        if (!response.ok) throw Object.assign(new Error(body?.error || "Sprint-Plan konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        if (!Array.isArray(body?.sprints)) throw new Error("Die Planung ist noch nicht bestätigt.");
        return { sprints: body.sprints };
      },
      readWorkweekCalendar: scope => readPublishedWorkweekCalendar(ownedApiClient, scope),
      async saveReviewWindow(expectedHours, hours) {
        const { response, body } = await planningApi.updateSprintReviewWindowRequest(ownedApiClient, expectedHours, hours);
        if (!response.ok) throw Object.assign(new Error(body?.error || "Prozesseinstellung konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        if (!body?.project || !Array.isArray(body.sprints)) throw new Error("Die Speicherung ist noch nicht bestätigt.");
        return { project: body.project, sprints: body.sprints };
      },
      async saveSprint(sprint, patch) {
        const { response, body } = await planningApi.updateSprintRequest(ownedApiClient, sprint.id, { ...patch, expectedUpdatedAt: sprint.updatedAt });
        if (!response.ok) throw Object.assign(new Error(body?.error || "Sprint konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        if (!body?.sprint?.updatedAt) throw new Error("Die Speicherung ist noch nicht bestätigt.");
        return { sprint: body.sprint };
      },
      async readHeader(slots) {
        const { response, body } = await planningApi.requestPlanningHeaderData(ownedApiClient, slots);
        if (!response.ok || !body?.headerData) throw Object.assign(new Error(body?.error || "Headerdaten konnten nicht geladen werden."), { status: response.status });
        return normalizePlanningHeaderData(body.headerData);
      },
      async updateNotification(eventId, action) {
        const { response, body } = await planningApi.updateNotificationStatusRequest(ownedApiClient, eventId, action);
        if (!response.ok) throw Object.assign(new Error(body?.error || "Benachrichtigung konnte nicht aktualisiert werden."), { status: response.status, code: body?.code });
        if (!body?.ok || !body.action || !body.status) throw new Error("Bestätigung unvollständig.");
        return { action: body.action, status: body.status };
      },
      async readPlatformReleases() {
        const { response, body } = await ownedApiClient.requestJson<{ releases?: import("@/features/platform-releases/model/platform-release-model").PlatformReleaseRecord[]; error?: string }>("/api/team/platform-releases/v1/releases");
        if (!response.ok || !Array.isArray(body?.releases)) throw Object.assign(new Error(body?.error || "Releases konnten nicht geladen werden."), { status: response.status });
        return body.releases;
      },
      async markPlatformReleaseSeen(version) {
        const { response, body } = await ownedApiClient.requestJson<{ ok?: boolean; error?: string }>(`/api/team/platform-releases/v1/releases/${encodeURIComponent(version)}/seen`, { method: "POST" });
        if (!response.ok) throw Object.assign(new Error(body?.error || "Release konnte nicht bestätigt werden."), { status: response.status });
        if (!body?.ok) throw new Error("Bestätigung unvollständig.");
      },
      async readTools() {
        const { response, body } = await planningApi.requestSupportingWorkspaceData(ownedApiClient, "tools");
        if (!response.ok || !body?.model) throw Object.assign(new Error(body?.error || "Links konnten nicht geladen werden."), { status: response.status });
        const model = body.model as import("@/features/tools/model/tools-read-model").ToolsWorkspaceModel;
        return { tools: model.tools, completeness: model.coverage || "partial", headerData: body.headerData ? normalizePlanningHeaderData(body.headerData) : undefined };
      },
      async createTool(draft) {
        const { response, body } = await planningApi.createFmdToolRequest(ownedApiClient, draft);
        if (!response.ok || !body?.tool) throw Object.assign(new Error(body?.error || "Link konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        return { tool: body.tool, warning: body.warning };
      },
      async updateTool(basis, draft) {
        const { response, body } = await planningApi.updateFmdToolRequest(ownedApiClient, basis.id, { ...draft, expectedUpdatedAt: basis.updatedAt });
        if (!response.ok || !body?.tool) throw Object.assign(new Error(body?.error || "Link konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        return { tool: body.tool, warning: body.warning };
      },
      async uploadToolPreview(file) {
        const session = await currentOperationSession();
        const { response, body } = await planningApi.uploadFmdToolPreviewImageRequest(ownedApiClient, file, { userId: session.userId, revision: session.revision });
        if (!response.ok || !body?.imageUrl || body.source !== "manual") throw Object.assign(new Error(body?.error || "Bild-Upload ist noch nicht bestätigt."), { status: response.status, code: body?.code });
        return { imageUrl: body.imageUrl, source: body.source };
      },
      async readToolPreview(imageUrl) {
        if (!isProtectedToolPreviewUrl(imageUrl)) throw new Error("Der Bildpfad ist nicht verfügbar.");
        const { response } = await ownedApiClient.requestBlob(imageUrl);
        if (!response.ok) throw Object.assign(new Error("Das Vorschaubild konnte nicht geprüft werden."), { status: response.status });
        return true;
      },
      async readEvents(range) {
        const query = range ? `?${new URLSearchParams(range)}` : "";
        const { response, body } = await ownedApiClient.requestJson<{ model?: import("@/features/events/model/events-read-model").EventsWorkspaceModel; headerData?: PlanningHeaderData; error?: string }>(`/api/events-data${query}`);
        if (!response.ok || !body?.model) throw Object.assign(new Error(body?.error || "Events konnten nicht geladen werden."), { status: response.status });
        return { events: body.model.events, coverage: body.model.coverage || { range, completeness: "partial" }, headerData: body.headerData ? normalizePlanningHeaderData(body.headerData) : undefined };
      },
      async createEvent(draft) {
        const { response, body } = await planningApi.createFounderEventRequest(ownedApiClient, draft);
        if (!response.ok || !body?.event) throw Object.assign(new Error(body?.error || "Event konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        return { event: body.event, warning: body.warning };
      },
      async updateEvent(basis, draft) {
        const { response, body } = await planningApi.updateFounderEventRequest(ownedApiClient, basis.id, { ...draft, expectedUpdatedAt: basis.updatedAt });
        if (!response.ok || !body?.event) throw Object.assign(new Error(body?.error || "Event konnte nicht aktualisiert werden."), { status: response.status, code: body?.code });
        return { event: body.event, warning: body.warning };
      },
      async createTask(input) {
        const { response, body } = await taskApi.createTaskRequest(ownedApiClient, input);
        if (!response.ok && !(body?.code === "task_created_approval_failed" && body.task?.updatedAt)) throw Object.assign(new Error(body?.error || "Aufgabe konnte nicht erstellt werden."), { status: response.status, code: body?.code });
        if (!body?.task) throw new Error("Die Erstellung ist noch nicht bestätigt.");
        return { task: body.task, relation: body.relation, relatedTask: body.relatedTask, approvalError: body.code === "task_created_approval_failed" ? body.error || "Die Aufgabe wurde erstellt. Die Freigabe ist fehlgeschlagen." : undefined };
      },
      async removeTask(task, action, reason) {
        if (action === "delete_epic") {
          const { response, body } = await planningApi.deleteEpicRequest(ownedApiClient, task.id, { expectedUpdatedAt: task.updatedAt || "" });
          if (!response.ok) throw Object.assign(new Error(body && "error" in body && body.error || "Meilenstein konnte nicht gelöscht werden."), { status: response.status });
          if (!body || !("task" in body) || body.task?.id !== task.id || body.task.taskType !== "epic") throw new Error("Das Löschen ist noch nicht bestätigt.");
          return { affectedTaskIds: [body.task.id] };
        }
        if (action === "withdraw") {
          const { response, body } = await taskApi.withdrawTaskRequest(ownedApiClient, task.id, task.approvalRevision, reason);
          if (!response.ok) throw Object.assign(new Error(body?.error || "Deliverable konnte nicht zurückgezogen werden."), { status: response.status, code: body?.code });
          return { affectedTaskIds: body?.affectedTaskIds };
        }
        const { response, body } = await taskApi.decideTaskApprovalRequest(ownedApiClient, task.id, "reject", task.approvalRevision, reason);
        if (!response.ok) throw Object.assign(new Error(body?.error || "Freigabeentscheidung konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        if (!body?.task?.updatedAt || body.task.approvalStatus !== "rejected") throw new Error("Die Ablehnung ist noch nicht bestätigt.");
        return {};
      },
      async saveTeamProfile(profileId, patch, expected) {
        const { response, body } = await planningApi.updateProfileRequest(ownedApiClient, profileId, { ...patch, expected });
        if (!response.ok || body?.profile?.id !== profileId) throw Object.assign(new Error(body?.error || "Profil konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        return { ...body.profile, id: profileId };
      },
      async saveOwnProfileSettings(patch) {
        const { response, body } = await planningApi.updateOwnProfileSettingsRequest(ownedApiClient, { ...patch.profilePatch, expected: patch.expected, profileColorDuplicateMode: patch.profileColorDuplicateMode, notificationEvents: patch.notificationEvents, uiPreferences: patch.uiPreferences });
        if (!response.ok || !body?.profile) throw Object.assign(new Error(body?.error || "Profil konnte nicht gespeichert werden."), { status: response.status, code: body?.code });
        return { profile: body.profile, uiPreference: body.uiPreference, notificationPreferences: body.notificationPreferences || [] };
      },
      async acknowledgeFeatureTour(tourId) {
        const { response, body } = await planningApi.markProfileFeatureTourSeenRequest(ownedApiClient, tourId);
        if (!response.ok || !body?.acknowledgement) throw Object.assign(new Error(body?.error || "Die Bestätigung der Hilfe-Tour steht noch aus."), { status: response.status, code: body?.code });
        return body.acknowledgement;
      },
      async readProfileApiTokens() {
        const { response, body } = await profileTokenApi.loadPlanningItemsTokens(ownedApiClient);
        if (!response.ok || !body?.tokens) throw Object.assign(new Error(body?.error || "Planning-API-Tokens konnten nicht geladen werden."), { status: response.status, code: body?.code });
        return { tokens: body.tokens, canIssueEmptyEpicDeletes: Boolean(body.capabilities?.canIssueEmptyEpicDeletes) };
      },
      async issueProfileApiToken(draft) {
        const { response, body } = await profileTokenApi.createPlanningItemsToken(ownedApiClient, draft.label, draft.allowUpdates, draft.allowEmptyEpicDeletes, draft.allowGitHubSync);
        if (!response.ok || !body?.token || !body.tokenRecord) throw Object.assign(new Error(body?.error || "Planning-API-Token konnte nicht erstellt werden."), { status: response.status, code: body?.code });
        return { token: body.token, tokenRecord: body.tokenRecord };
      },
      async revokeProfileApiToken(tokenId) {
        const { response, body } = await profileTokenApi.revokePlanningItemsToken(ownedApiClient, tokenId);
        if (!response.ok || !body?.ok) throw Object.assign(new Error(body?.error || "Planning-API-Token konnte nicht widerrufen werden."), { status: response.status, code: body?.code });
      },
      async saveTask(task, patch) {
        const { response, body } = await taskApi.updateTaskRequest(ownedApiClient, task.id, taskUpdateRequestPayload(patch, task.updatedAt || ""));
        if (!response.ok) throw Object.assign(new Error(body?.error || "Änderung konnte nicht gespeichert werden."), { status: response.status, code: body?.code, kind: body?.conflictReason === "revision" ? "versionConflict" : undefined });
        return { task: body?.task || {}, activities: body?.activities };
      },
      async saveSprintCommitment(basis, patch) {
        const { response, body } = await ownedApiClient.requestJson<import("@/features/sprint/model/sprint-commitment-editing").SprintCommitmentConfirmation & {error?:string;code?:string}>("/api/sprint-commitments", { method:"PUT", json:{...basis,...patch,expectedUpdatedAt:basis.id===0?null:basis.updatedAt},useDevProfileOverride:false });
        if(!response.ok||!body?.commitment)throw Object.assign(new Error(body?.error||"Commitment konnte nicht gespeichert werden."),{status:response.status,code:body?.code});
        return {commitment:body.commitment,auditError:body.auditError};
      },
      async readTaskDetail(taskId) {
        const { response, body } = await taskApi.requestTaskDetailData(ownedApiClient, taskId);
        if (!response.ok || !body?.taskDetail) throw Object.assign(new Error(body?.error || "Task-Details konnten nicht geladen werden."), { status: response.status });
        return { model: body.taskDetail, unavailable: body.unavailable };
      },
      async readWorkspace(workspace) {
        if (workspace === "planning" || workspace === "projects") {
          const { response, body } = await planningApi.requestPlanningWorkspaceData(ownedApiClient, workspace);
          if (!response.ok) throw Object.assign(new Error(body?.error || "Planungsdaten konnten nicht geladen werden."), { status: response.status });
          return body?.model ? { data: normalizePlanningShellState(planningWorkspaceModelToPlanningShellState(body.model)), coverage: hierarchyReadCoverage(body.model), profileOmittedFields: ["notificationsEnabled", "googleChatUserId", "googleChatDmSpace"], projectOmittedFields: ["githubProjectOwner", "githubProjectNumber"], taskCoverage: body.model.coverage?.items || "partial", taskOmittedFields: hierarchyOmittedFields(body.model), headerData: body.headerData, currentProfile: body.currentProfile } : null;
        }
        if (workspace === "backlog") {
          const { response, body } = await requestBacklogModel(ownedApiClient);
          if (!response.ok || !body?.model) throw Object.assign(new Error(body?.error || "Backlog konnte nicht geladen werden."), { status: response.status });
          return { data: backlogModelToPlanningShellState(body.model), coverage: backlogModelCoverage(body.model), profileOmittedFields: ["notificationsEnabled", "googleChatUserId", "googleChatDmSpace"], taskCoverage: body.model.coverage?.items || "partial", taskOmittedFields: backlogOmittedFields(body.model), backlogCoverage: body.model.coverage };
        }
        if (isSupportingWorkspace(workspace)) {
          const { response, body } = await planningApi.requestSupportingWorkspaceData(ownedApiClient, workspace);
          if (!response.ok) throw Object.assign(new Error(body?.error || "Planungsdaten konnten nicht geladen werden."), { status: response.status });
          return body?.model ? { data: normalizePlanningShellState(supportingWorkspaceModelToPlanningShellState(workspace, body.model)), coverage: supportingReadCoverage(workspace, body.model), taskOmittedFields: supportingOmittedFields(body.model), profileOmittedFields: ["notificationsEnabled", "googleChatUserId", "googleChatDmSpace"], projectOmittedFields: ["githubProjectOwner", "githubProjectNumber"], toolCoverage: workspace === "tools" ? (body.model as import("@/features/tools/model/tools-read-model").ToolsWorkspaceModel).coverage : undefined, eventCoverage: workspace === "events" ? (body.model as import("@/features/events/model/events-read-model").EventsWorkspaceModel).coverage : undefined, notificationCoverage: workspace === "notifications" ? (body.model as import("@/features/notifications/model/notifications-read-model").NotificationsWorkspaceModel).coverage : undefined, headerData: body.headerData, currentProfile: body.currentProfile } : null;
        }
        if (workspace === "sprint") {
          const { response, body } = await planningApi.requestSprintWorkspaceData(ownedApiClient);
          if (!response.ok) throw Object.assign(new Error(body?.error || "Planungsdaten konnten nicht geladen werden."), { status: response.status });
          return body?.model ? { data: normalizePlanningShellState(sprintWorkspaceModelToPlanningShellState(body.model)), coverage: sprintModelCoverage(body.model), taskOmittedFields: supportingOmittedFields(body.model), profileOmittedFields: ["notificationsEnabled", "googleChatUserId", "googleChatDmSpace"], projectOmittedFields: ["githubProjectOwner", "githubProjectNumber"], headerData: body.headerData, currentProfile: body.currentProfile } : null;
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
  return {
    initialPage: options,
    acceptHeaderHydration: owner.internal.acceptHeaderHydration,
    owner,
    runtime,
    acceptProtectedData(data: PlanningShellState, account: string, workspace: AppWorkspace = runtime.workspace) {
      if (!isCurrent() || account !== runtime.userId) return;
      owner.internal.acceptHydration(data, account, workspace);
    },
  };

}

export type BrowserPlanningState = ReturnType<typeof createBrowserPlanningState>;
