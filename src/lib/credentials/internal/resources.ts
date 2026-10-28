import "server-only";
import { disconnectBookkeeping } from "./disconnect-bookkeeping";
import { getGoogleWorkspaceDisconnectView, disconnectGoogleWorkspace } from "@/features/team-workweek/server/google-workspace-disconnect";
import { boundGoogleConnectionStatus } from "./google-calendar";
import { authorizeGitHubInstallation } from "./github-installation";
import { githubConnectionSession } from "./github-user";
import { getGitHubUserConnectionStatus } from "./github-user-vault";
import { runWithDeliveryAdmission } from "./delivery-admission-scope";
import { countWaitingGitHubCommentsForAuthor } from "../../github-comment-delivery";
import { FOUNDEROPS_GITHUB_REPOSITORIES } from "../../github-project-config";
import { allowedGitHubAssetUrl } from "../../github-asset-policy";
import type { ResourceCredentialInput, EventWrite, ResourceAuditMetadata } from "../resource-types";
import { canManageNotificationEvent, type NotificationUserAction } from "../../notification-lifecycle";
import { loadFmdToolMetadata } from "../../fmd-tool-metadata";
import { persistTool, type ToolValues } from "@/features/tools/model/tool-persistence";
import type { DbFmdTool } from "../../planning-row-types";
import type { DbFounderEvent } from "../../planning-row-types";
import { assertFounderEventParticipantsExist, founderEventSelect, validateFounderEventRow } from "@/features/events/model/event-api";
import { resourceAuthority } from "./resource-authority";

import { createSupabaseEventsReadModel } from "@/features/events/server/events-read-model-supabase";
import { createSupabaseToolsReadModel } from "@/features/tools/server/tools-read-model-supabase";
import { createSupabaseStrategicPlanningReadModel } from "@/features/projects/server/strategic-planning-read-model-supabase";
import { createSupabaseTeamReadModel } from "@/features/team/server/team-read-model-supabase";
import { createSupabaseNotificationsReadModel } from "@/features/notifications/server/notifications-read-model-supabase";
import { loadPlanningHeaderData } from "../../planning-header-data";
import { planningHeaderSlotLoaders } from "./planning-header-cache";

const actions = new Set(["events.read", "tools.read", "strategic.read", "team.read", "notifications.read", "events.create", "events.update", "tools.create", "tools.update", "tools.metadata", "notification.status.write", "connection.github.read", "connection.github.disconnect", "assets.github.read", "connection.google.read", "connection.google.disconnect.preview", "connection.google.disconnect"]);
export const isResourceAction = (value: string) => actions.has(value);
const eventFields = ["title", "category", "starts_at", "ends_at", "location", "description", "audience_mode", "participant_profile_ids", "reminder_days_before", "reminder_generated_at", "status", "updated_at"] as const;
const denied = () => ({ data: null, error: { code: "42501", message: "Keine Berechtigung für diese Aktion." } });

export async function authorizeResource(input: ResourceCredentialInput) {
  const startedAt = Date.now(), action = input.action;
  const target = "targetId" in input ? input.targetId || "" : "";
  const context = await resourceAuthority(input, startedAt);
  if (!context.ok) return context;
  const { profile, service, followup, correction, userData } = context;
  const bound = context;
  async function load<M>(readModel: { load(context: { authorized: boolean; actorProfileId: string | null }): Promise<{ status: "ready"; model: M } | { status: "forbidden" } | { status: "unavailable" }> }) {
      // Admission runs outside the shared data cache on hits and misses.
      try { await bound.current(); bound.assertCurrent(); }
      catch { return { status: "unavailable" as const }; }
      const [result, headerData] = await Promise.all([
        readModel.load({ authorized: true, actorProfileId: profile?.id || null }),
        loadPlanningHeaderData(service, { currentProfileId: profile?.id || null, platformRole: profile?.platformRole || null, sharedSlotLoaders: planningHeaderSlotLoaders(service) }),
      ]);
      return result.status === "ready" ? { ...result, headerData } : result;
  }
  let observedNotification: { id: number; recipient_profile_id: string | null; status: string; seen_at: string | null; dismissed_at: string | null } | null = null;
  let observedTool: DbFmdTool | null = null;
  let observedEvent: DbFounderEvent | null = null;
  return { ok: true as const, profile, resource: {
    loadStrategic() {
      if (action !== "strategic.read") return Promise.resolve({ status: "forbidden" as const });
      return load(createSupabaseStrategicPlanningReadModel(service));
    },
    loadWorkspace(options?: { eventsRange?: import("@/features/events/model/event-state").EventRange | null }) {
      if (action === "events.read") return load(createSupabaseEventsReadModel(service, options?.eventsRange));
      if (action === "tools.read") return load(createSupabaseToolsReadModel(service));
      if (action === "strategic.read") return load(createSupabaseStrategicPlanningReadModel(service));
      if (action === "team.read") return load(createSupabaseTeamReadModel(service));
      if (action === "notifications.read") return load(createSupabaseNotificationsReadModel(service));
      return Promise.resolve({ status: "forbidden" as const });
    },
    async readGoogleConnection() {
      if (action !== "connection.google.read" || !profile || !context.strictService) throw new Error("Google-Verbindungsstatus ist nicht verfügbar.");
      const [connection, cleanup] = await Promise.all([
        boundGoogleConnectionStatus({ ...context, profile }),
        context.strictService.from("google_workspace_disconnect_operations").select("id").eq("owner_profile_id", profile.id).neq("state", "completed").limit(1),
      ]);
      if (cleanup.error) throw new Error("Google-Verbindungsstatus ist nicht verfügbar.");
      return { connection, disconnectPending: Boolean(cleanup.data?.length) };
    },
    async readGoogleDisconnect() {
      if (action !== "connection.google.disconnect.preview" || !profile || !context.strictService) throw new Error("Trennungsvorschau ist nicht verfügbar.");
      return getGoogleWorkspaceDisconnectView(context.strictService, profile.id);
    },
    async disconnectGoogle() {
      if (action !== "connection.google.disconnect" || !profile || !context.strictService) throw new Error("Trennung ist nicht verfügbar.");
      return disconnectGoogleWorkspace({ request: context.request, ownerProfileId: profile.id, serviceSupabase: context.strictService, bookkeeping: disconnectBookkeeping(context.strictService, context.strictFollowup!, profile.id) });
    },
    async readGitHubConnection() {
      if (action !== "connection.github.read" || !profile) throw new Error("Keine Berechtigung für diese Aktion.");
      const user = await getGitHubUserConnectionStatus(service, profile);
      const waitingCommentCount = await countWaitingGitHubCommentsForAuthor(service, profile.id).catch(() => null);
      await context.current(); context.assertCurrent();
      return { user, waitingCommentCount };
    },
    async disconnectGitHub() {
      if (action !== "connection.github.disconnect" || !profile) throw new Error("Keine Berechtigung für diese Aktion.");
      return githubConnectionSession({ credential: { kind: "session-request", request: context.request }, action: "github.connection.disconnect" }, { profileId: profile.id, vault: service });
    },
    async readGitHubAsset() {
      if (action !== "assets.github.read" || !allowedGitHubAssetUrl(target)) throw new Error("Keine Berechtigung für diese Aktion.");
      return runWithDeliveryAdmission(async () => { await context.current(); return context.assertCurrent; }, async () => {
        let permission;
        try { permission = await authorizeGitHubInstallation({ credential: { kind: "github-installation" }, action: "github.asset.read", target: { repositories: [...FOUNDEROPS_GITHUB_REPOSITORIES], assetUrl: target } }); }
        catch (error) { return { kind: "acquisition-failed" as const, message: error instanceof Error ? error.message : "GitHub-Verbindung konnte nicht geprüft werden." }; }
        try { return { kind: "response" as const, response: await permission.github.asset(target) }; }
        catch { return { kind: "request-failed" as const }; }
      });
    },
    async readNotification() {
      if (action !== "notification.status.write" || !Number.isInteger(Number(target)) || Number(target) <= 0) return denied();
      const result = await service.from("notification_events").select("id,recipient_profile_id,status,seen_at,dismissed_at").eq("id", Number(target)).single();
      if (result.data) observedNotification = structuredClone(result.data);
      return result;
    },
    async saveNotificationStatus(operation: NotificationUserAction) {
      const event = observedNotification && structuredClone(observedNotification);
      if (action !== "notification.status.write" || !event || event.id !== Number(target) || !["seen", "dismiss"].includes(operation) || !canManageNotificationEvent(profile, event.recipient_profile_id)) return { error: { code: "42501", message: "Keine Berechtigung für diese Notification." } };
      if (event.status !== "pending") return { error: null, status: event.status };
      const now = new Date().toISOString();
      const update = operation === "seen" ? { seen_at: event.seen_at || now } : { status: "dismissed", seen_at: event.seen_at || now, dismissed_at: event.dismissed_at || now };
      const result = await service.from("notification_events").update(update).eq("id", Number(target)).eq("status", "pending");
      return { error: result.error, status: operation === "dismiss" ? "dismissed" : "pending" };
    },
    async loadMetadata(url: string) {
      if (action !== "tools.metadata") throw new Error("Keine Berechtigung für diese Aktion.");
      return loadFmdToolMetadata(url, { current: context.current, assertCurrent: context.assertCurrent });
    },
    async readTool() {
      if (action !== "tools.update") return denied();
      const result = await service.from("fmd_tools").select("id,name,category,kind,description,url,owner,status,is_curated,preview_image_url,preview_image_source,sort_order,updated_at").eq("id", target).single<DbFmdTool>();
      if (result.data) observedTool = structuredClone(result.data);
      return result;
    },
    async saveTool(supplied: ToolValues, suppliedMetadata: ResourceAuditMetadata, expectedUpdatedAt?: string) {
      const fields = ["name", "category", "kind", "description", "url", "owner", "status", "is_curated", "preview_image_url", "preview_image_source"] as const;
      const values = structuredClone(Object.fromEntries(fields.map(field => [field, supplied[field]]))) as ToolValues;
      const metadata = { request_ip: suppliedMetadata.request_ip || null, user_agent: suppliedMetadata.user_agent || null };
      if ((action !== "tools.create" && action !== "tools.update") || (action === "tools.update" && !observedTool)) return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
      const operation = action === "tools.create" ? "create" : "update";
      const select = "id,name,category,kind,description,url,owner,status,is_curated,preview_image_url,preview_image_source,sort_order,updated_at";
      return persistTool(values, operation, {
        countCurated: () => {
          const query = service.from("fmd_tools").select("id", { count: "exact", head: true }).eq("is_curated", true).not("url", "is", null);
          return operation === "update" ? query.neq("id", target) : query;
        },
        maximumOrder: () => service.from("fmd_tools").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle(),
        async save(row) {
          if (operation === "create") return service.from("fmd_tools").insert(row).select(select).single<DbFmdTool>();
          let query = service.from("fmd_tools").update(row).eq("id", target);
          if (expectedUpdatedAt !== undefined) query = query.eq("updated_at", expectedUpdatedAt);
          const result = await query.select(select).maybeSingle<DbFmdTool>();
          if (!result.error && !result.data && expectedUpdatedAt !== undefined) return { data: null, error: { code: "tool_version_conflict", message: "Der Link wurde zwischenzeitlich geändert. Bitte den aktuellen Serverstand prüfen." } };
          return result;
        },
        audit: (row, saved) => followup.from("audit_log").insert({ actor_profile_id: profile?.id || null, action: operation === "create" ? "fmd_tool.create" : "fmd_tool.update",
          entity_type: "fmd_tool", entity_id: saved.id, ...(operation === "update" ? { before_data: observedTool } : {}), after_data: row, ...metadata }),
      });
    },
    async readEvent() {
      if (action !== "events.update" || !Number.isFinite(Number(target))) return denied();
      const result = await service.from("founder_events").select(founderEventSelect).eq("id", Number(target)).single<DbFounderEvent>();
      if (result.data) observedEvent = structuredClone(result.data);
      return result;
    },
    async saveEvent(supplied: EventWrite, suppliedMetadata: ResourceAuditMetadata, expectedUpdatedAt?: string) {
      const row = structuredClone(Object.fromEntries(eventFields.map(field => [field, supplied[field]]))) as EventWrite;
      const metadata = { request_ip: suppliedMetadata.request_ip || null, user_agent: suppliedMetadata.user_agent || null };
      if ((action !== "events.create" && action !== "events.update") || !profile || (action === "events.update" && !observedEvent)) return denied();
      const validation = validateFounderEventRow(row);
      if (validation) return { data: null, error: null, participantError: validation.message, validationStatus: validation.status };
      const participantError = await assertFounderEventParticipantsExist(service, row.participant_profile_ids || []);
      if (participantError) return { data: null, error: null, participantError };
      const write = correction ? userData : service;
      if (!write) return { data: null, error: { code: "42501", message: "Anmeldung erforderlich." } };
      // User-bound administrator writes keep the distinct table permit, rather than replacing the effect with an RPC.
      if (correction) {
        try { await context.current(); context.assertCurrent(); }
        catch { return denied(); }
      }
      const values = action === "events.create" ? { ...row, created_by: profile.id } : row;
      let result;
      if (action === "events.create") result = await write.from("founder_events").insert(values).select(founderEventSelect).single<DbFounderEvent>();
      else {
        let query = write.from("founder_events").update(values).eq("id", Number(target));
        if (expectedUpdatedAt !== undefined) query = query.eq("updated_at", expectedUpdatedAt);
        result = await query.select(founderEventSelect).maybeSingle<DbFounderEvent>();
        if (!result.error && !result.data) return { data: null, error: { code: "event_version_conflict", message: "Event wurde zwischenzeitlich geändert. Bitte den aktuellen Stand prüfen." } };
      }
      if (!result.error && result.data) {
        try {
          const audit = await followup.from("audit_log").insert({ actor_profile_id: profile.id, action: action === "events.create" ? "founder_event.create" : "founder_event.update",
            entity_type: "founder_event", entity_id: String(result.data.id), ...(action === "events.update" ? { before_data: observedEvent } : {}), after_data: values, ...metadata });
          if (audit.error) return { ...result, auditUnconfirmed: true };
        } catch { return { ...result, auditUnconfirmed: true }; }
      }
      return result;
    },
  } };
}
