import "server-only";
import type { SessionAuthorityContext } from "@/features/administrator-access/model/administrator-access";
import type { NextRequest } from "next/server";
import type { AccountCredentialInput, AccountSettingsUpdate, AccountGitHubProjectUpdate, AccountNotificationPreferenceUpdate, AccountPreviewUpload } from "../account-types";
import { randomUUID } from "node:crypto";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { DbNotificationPreference, DbProfileFeatureTourAcknowledgement } from "../../planning-row-types";
import { googleChatDigestEventTypes } from "../../notification-policy";
import { authorizeSessionPolicy, currentAdministratorAccess, administratorAccessFailure } from "./session-policy";
import { accountService, accountServiceConfiguration } from "./account-service";
import { WorkspaceAccessError } from "../../workspace-identity";
import { validToolPreviewPath } from "../../tool-preview-image";
import { getServerAuthSupabase } from "./cookie-client";
import { authorizeSessionData } from "./session";
import { resolveSessionRequest } from "./session-request";
import { createSupabaseProfileReadModel } from "@/features/profile/server/profile-read-model-supabase";
import { emptyPlanningHeaderData, loadPlanningHeaderData } from "../../planning-header-data";
import { planningHeaderSlotLoaders } from "./planning-header-cache";
import { platformReleaseSeed } from "@/features/platform-releases/model/platform-release-seed";
import { loadPlatformReleases } from "@/features/platform-releases/server/platform-release-read-model-supabase";
import { requiresSupabaseAuth } from "../../supabase";

const accountActions = new Set(["account.profile.read", "account.settings.update", "account.github-project.update", "account.notifications.update", "account.tour.acknowledge", "account.preview.write", "account.preview.read", "account.governance.update", "releases.read", "releases.seen"]);
function configurationFingerprint() {
  return JSON.stringify([accountServiceConfiguration(false),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.GOOGLE_AUTHORIZED_GROUP, process.env.GOOGLE_WORKLOAD_IDENTITY_AUDIENCE, process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT,
    process.env.NODE_ENV, process.env.VERCEL, process.env.REQUIRE_SUPABASE_AUTH, process.env.ENABLE_LOCAL_LOGIN, process.env.NEXT_PUBLIC_ENABLE_LOCAL_LOGIN]);
}
const settingsFields = new Set(["focus", "profile_color", "profile_color_duplicate_mode", "notifications_enabled"]);
const uiFields = new Set(["default_workspace", "default_task_view", "planning_filters", "expanded_item_ids"]);
const governanceFields = new Set(["platform_role", "org_role", "deputy_for", "deputy_active_from", "deputy_active_until", "weekly_capacity"]);
const notificationTypes = new Set<string>(googleChatDigestEventTypes);
const previewExtensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const pick = (value: object, fields: Set<string>) => Object.fromEntries(Object.entries(value).filter(([key]) => fields.has(key)));

export async function authorizeAccount(input: AccountCredentialInput) {
  const startedAt = Date.now();
  const action = input.action;
  if (!accountActions.has(action)) return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
  const version = "version" in input && typeof input.version === "string" ? input.version : "";
  const targetProfileId = "targetProfileId" in input && typeof input.targetProfileId === "string" ? input.targetProfileId : "";
  const previewPath = "path" in input && typeof input.path === "string" ? input.path : "";
  const configuration = accountServiceConfiguration(false);
  const strictConfiguration = accountServiceConfiguration(true);
  const configurationBinding = configurationFingerprint();
  let request: NextRequest;
  if (input.credential.kind === "server-cookies") {
    if (action !== "account.preview.read" && action !== "account.profile.read" && action !== "releases.read") return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
    if (action === "account.preview.read" && !validToolPreviewPath(previewPath)) return { ok: false as const, status: 400, error: "Ungültiger Bildpfad." };
    if (action === "account.preview.read" && (!strictConfiguration.url || !strictConfiguration.key)) return { ok: false as const, status: 401, error: "Anmeldung erforderlich." };
    if ((action === "account.profile.read" || action === "releases.read") && !requiresSupabaseAuth()) {
      request = { headers: new Headers({ host: "localhost" }), method: "GET" } as NextRequest;
    } else {
      const client = await getServerAuthSupabase();
      if (!client) return { ok: false as const, status: 401, error: "Anmeldung erforderlich." };
      const current = await client.auth.getSession();
      if (current.error && isAuthRetryableFetchError(current.error)) return { ok: false as const, status: 503, error: "Anmeldung konnte vorübergehend nicht geprüft werden." };
      if (current.error || !current.data.session?.access_token) return { ok: false as const, status: 401, error: "Anmeldung ungültig oder abgelaufen." };
      request = { headers: new Headers({ authorization: `Bearer ${current.data.session.access_token}` }), method: "GET" } as NextRequest;
    }
  } else if (input.credential.kind === "session-request") {
    const original = input.credential.request;
    request = { headers: new Headers(original.headers), method: original.method, url: original.url, nextUrl: original.nextUrl } as NextRequest;
  } else return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
  if (["account.settings.update", "account.notifications.update", "account.tour.acknowledge", "account.preview.write", "account.profile.read"].includes(action) && (!configuration.url || !configuration.key)) return { ok: false as const, status: 501, error: "Supabase env is not configured." };
  const policyAction = action === "account.github-project.update" ? "administration.technical" : action === "account.governance.update" ? "governance.ceo" : action === "account.notifications.update" || action === "account.preview.write" ? "planning.contribute" : "team.read";
  let candidate = action === "account.preview.read" ? await authorizeSessionData(request, "team.read", startedAt) : await authorizeSessionPolicy(request, policyAction, startedAt);
  if (!candidate.ok) return candidate;
  if (action === "account.governance.update" && !candidate.data) {
    if (!resolveSessionRequest(request).token) return { ok: false as const, status: 401, error: "Anmeldung erforderlich." };
    const verified = await authorizeSessionData(request, "governance.ceo", startedAt);
    if (!verified.ok) return verified;
    if (verified.profile.platformRole !== "ceo") return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
    candidate = verified;
  }
  const permission = candidate;
  const profile = permission.profile ? Object.freeze({ ...permission.profile }) : null;
  const authority = (permission as { authority?: SessionAuthorityContext }).authority;
  const administratorDeadline = authority ? Date.parse(authority.administratorAccess.expiresAt || "") : Infinity;
  const assertCurrent = () => {
    if ("assertCurrent" in permission) permission.assertCurrent();
    if (action === "account.github-project.update" && Date.now() >= administratorDeadline) throw new WorkspaceAccessError(403, "workspace_access_denied");
    if (configurationFingerprint() !== configurationBinding) throw new WorkspaceAccessError(503, "workspace_access_unavailable");
  };
  const userData = "constrainedData" in permission ? permission.constrainedData(assertCurrent) : permission.data;
  const current = async () => {
    const latest = action === "account.preview.read" ? await authorizeSessionData(request, "team.read", startedAt) : await authorizeSessionPolicy(request, policyAction, startedAt);
    if (!latest.ok) throw new WorkspaceAccessError(latest.status >= 500 ? 503 : 403, latest.status >= 500 ? "workspace_access_unavailable" : "workspace_access_denied");
    if (latest.profile?.id !== profile?.id || latest.profile?.platformRole !== profile?.platformRole) throw new WorkspaceAccessError(403, "workspace_access_denied");
  };
  const service = accountService(false, current, assertCurrent, configuration)!;
  const strictService = accountService(true, current, assertCurrent, strictConfiguration);
  return { ok: true as const, profile, account: {
    async markReleaseSeen() {
      if (action !== "releases.seen") return { error: { status: 403, message: "Keine Berechtigung für diese Aktion." } };
      if (!profile) return { error: null };
      if (!/^v\d+\.\d+\.\d+$/.test(version)) return { error: { status: 400, message: "Ungültige Version." } };
      if (!strictService) return { error: { status: 503, message: "Lesestatus ist nicht verfügbar." } };
      const { error } = await strictService.from("notification_events").update({ seen_at: new Date().toISOString() })
        .eq("recipient_profile_id", profile.id).eq("entity_type", "platform_release").eq("entity_id", version).is("seen_at", null);
      return error ? { error: { status: 500, message: "Lesestatus konnte nicht gespeichert werden." } } : { error: null };
    },
    async loadReleaseHeader() {
      if (action !== "releases.read" || !strictService) return { available: false as const, headerData: emptyPlanningHeaderData };
      try {
        assertCurrent();
        await current();
        assertCurrent();
        const headerData = await loadPlanningHeaderData(strictService, { currentProfileId: profile?.id || null, platformRole: profile?.platformRole || null, sharedSlotLoaders: planningHeaderSlotLoaders(strictService) });
        assertCurrent();
        return { available: true as const, headerData };
      } catch { return { available: false as const, headerData: emptyPlanningHeaderData }; }
    },
    async readReleases() {
      if (action !== "releases.read") return { available: false as const, releases: [] };
      if (!strictService) return { available: false as const, releases: process.env.NODE_ENV === "development" ? platformReleaseSeed : [] };
      try {
        assertCurrent();
        await current();
        assertCurrent();
        const releases = await loadPlatformReleases(strictService, profile?.id || null);
        assertCurrent();
        return { available: true as const, releases };
      } catch { return { available: false as const, releases: [] }; }
    },
    async loadProfile() {
      if (action !== "account.profile.read") return { status: "forbidden" as const };
      if (!service) return { status: "unavailable" as const };
      try {
        assertCurrent();
        await current();
        assertCurrent();
        const [result, headerData] = await Promise.all([
          createSupabaseProfileReadModel(service).load({ authorized: true, actorProfileId: profile?.id || null }),
          loadPlanningHeaderData(service, { currentProfileId: profile?.id || null, platformRole: profile?.platformRole || null, sharedSlotLoaders: planningHeaderSlotLoaders(service) }),
        ]);
        assertCurrent();
        return result.status === "ready" ? { ...result, headerData } : { status: result.status };
      } catch { return { status: "unavailable" as const }; }
    },
    async readPreview() {
      if (action !== "account.preview.read" || !strictService) return { data: null, error: { code: "42501", message: "Keine Berechtigung für diese Aktion." } };
      return await strictService.storage.from("fmd-tool-previews").download(previewPath);
    },
    async uploadPreview(value: AccountPreviewUpload) {
      const bytes = Uint8Array.from(value.bytes);
      const contentType = value.contentType;
      if (action !== "account.preview.write") return { path: null, error: { status: 403, message: "Keine Berechtigung für diese Aktion." } };
      if (!bytes.byteLength) return { path: null, error: { status: 400, message: "Bild ist leer." } };
      if (bytes.byteLength > 5 * 1024 * 1024) return { path: null, error: { status: 413, message: "Bild ist zu groß. Maximal erlaubt sind 5 MB." } };
      if (!Object.hasOwn(previewExtensions, contentType)) return { path: null, error: { status: 415, message: "Bildtyp wird nicht unterstützt." } };
      const path = `quicklinks/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${randomUUID()}.${previewExtensions[contentType]}`;
      if (!strictService) return { path: null, error: { status: 503, message: "Bild konnte nicht gespeichert werden." } };
      const { error } = await strictService.storage.from("fmd-tool-previews").upload(path, bytes, { contentType, upsert: false });
      return error ? { path: null, error: { status: 500, message: error.message || "Bild konnte nicht gespeichert werden." } } : { path, error: null };
    },
    async acknowledgeTour(tourId: string) {
      if (action !== "account.tour.acknowledge" || !profile) return { data: null, error: { code: "42501", message: "Profil konnte nicht bestimmt werden." } };
      if (!/^[a-z0-9][a-z0-9._-]{1,80}$/.test(tourId)) return { data: null, error: { code: "22023", message: "Tour-ID ist ungültig." } };
      return await service.from("profile_feature_tour_acknowledgements").upsert({ profile_id: profile.id, tour_id: tourId, seen_at: new Date().toISOString() }, { onConflict: "profile_id,tour_id" }).select("profile_id,tour_id,seen_at").single<DbProfileFeatureTourAcknowledgement>();
    },
    async administratorFailure() {
      if (action !== "account.github-project.update") return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
      if (Date.now() >= administratorDeadline) return administratorAccessFailure({ eligible: true, active: false, expiresAt: null });
      const result = permission.data ? await permission.data.rpc("administrator_access_snapshot") : null;
      return administratorAccessFailure(currentAdministratorAccess(result?.error ? null : result?.data));
    },
    async updateNotificationPreference(value: AccountNotificationPreferenceUpdate): Promise<{ data: DbNotificationPreference | null; error: { message: string; status: number } | null }> {
      const snapshot = structuredClone(value);
      if (action !== "account.notifications.update" || !profile || !(snapshot.profileId === profile.id || profile.platformRole === "ceo" || profile.platformRole === "deputy")) return { data: null, error: { status: 403, message: "Keine Berechtigung für diese Benachrichtigungseinstellung." } };
      if (!snapshot.profileId) return { data: null, error: { status: 400, message: "Profil ist erforderlich." } };
      if (!notificationTypes.has(snapshot.eventType)) return { data: null, error: { status: 400, message: "Unbekannter Benachrichtigungstyp." } };
      if (typeof snapshot.enabled !== "boolean") return { data: null, error: { status: 400, message: "Status ist erforderlich." } };
      const found = await service.from("profiles").select("id").eq("id", snapshot.profileId).single();
      if (found.error || !found.data) return { data: null, error: { status: 404, message: "Profil wurde nicht gefunden." } };
      const result = await service.from("notification_preferences").upsert({ profile_id: snapshot.profileId, channel: "google_chat", event_type: snapshot.eventType, enabled: snapshot.enabled, updated_at: new Date().toISOString() }, { onConflict: "profile_id,channel,event_type" }).select("id,profile_id,channel,event_type,enabled").single<DbNotificationPreference>();
      if (result.error) return { data: null, error: { status: 500, message: result.error.message } };
      await service.from("audit_log").insert({ actor_profile_id: profile.id, action: "notification_preference.update", entity_type: "notification_preference", entity_id: `${snapshot.profileId}:${snapshot.eventType}`, after_data: { profile_id: snapshot.profileId, channel: "google_chat", event_type: snapshot.eventType, enabled: snapshot.enabled }, request_ip: snapshot.metadata.request_ip || null, user_agent: snapshot.metadata.user_agent || null });
      return { data: result.data, error: null };
    },
    async updateGovernance(patch: Record<string, string | number | null>, metadata: { request_ip?: string | null; user_agent?: string | null }) {
      const snapshot = structuredClone({ patch, metadata });
      if (action !== "account.governance.update" || !userData) return { data: null, error: { code: "42501", message: "Nur der CEO kann fachliche Rollen verwalten." } };
      return await userData.rpc("update_profile_governance_transaction", {
        p_profile_id: targetProfileId, p_profile_patch: pick(snapshot.patch, governanceFields),
        p_request_ip: snapshot.metadata.request_ip || null, p_user_agent: snapshot.metadata.user_agent || null,
      });
    },
    async updateGitHubProject(value: AccountGitHubProjectUpdate) {
      const snapshot = structuredClone(value);
      if (action !== "account.github-project.update" || !permission.data) return { data: null, error: { code: "42501", message: "Ein aktiver Adminzugang ist erforderlich." } };
      const current = await permission.data.rpc("administrator_access_snapshot");
      if (current.error || !currentAdministratorAccess(current.data).active) return { data: null, error: { code: "42501", message: "Ein aktiver Adminzugang ist erforderlich." } };
      try { assertCurrent(); } catch {
        return { data: null, error: { code: Date.now() >= administratorDeadline ? "42501" : "AUTHORIZATION_UNAVAILABLE", message: "Adminzugang konnte nicht geprüft werden." } };
      }
      const result = await userData!.rpc("update_administration_github_project_transaction_v2", {
        p_project_id: "findmydoc-founder-execution", p_expected_owner: snapshot.expectedOwner,
        p_expected_number: snapshot.expectedNumber, p_expected_team_slug: snapshot.expectedTeamSlug,
        p_github_project_owner: snapshot.owner, p_github_project_number: snapshot.number,
        p_github_mention_team_slug: snapshot.teamSlug || null,
        p_request_ip: snapshot.metadata.request_ip || null, p_user_agent: snapshot.metadata.user_agent || null,
      });
      return result.error && Date.now() >= administratorDeadline ? { data: null, error: { code: "42501", message: "Der Adminzugang ist abgelaufen." } } : result;
    },
    async updateSettings(value: AccountSettingsUpdate) {
      const snapshot = structuredClone(value);
      if (action !== "account.settings.update" || !profile) return { data: null, error: { code: "42501", message: "Profil konnte nicht bestimmt werden." } };
      return await service.rpc("update_profile_settings_transaction", {
        p_profile_id: profile.id,
        p_profile_patch: pick(snapshot.profilePatch, settingsFields),
        p_ui_preferences: snapshot.uiPreferences ? pick(snapshot.uiPreferences, uiFields) : null,
        p_notification_events: Object.fromEntries(Object.entries(snapshot.notificationEvents).filter(([key, value]) => notificationTypes.has(key) && typeof value === "boolean")),
        p_request_ip: snapshot.metadata.request_ip || null,
        p_user_agent: snapshot.metadata.user_agent || null,
      });
    },
  } };
}
