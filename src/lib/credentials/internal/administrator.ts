import "server-only";
import type { NextRequest } from "next/server";
import type { AdministratorCredentialInput } from "../types";
import { authorizeSessionPolicy, administratorAccessFailure, currentAdministratorAccess } from "./session-policy";
import { getServerAuthSupabase } from "./cookie-client";
import { inactiveAdministratorAccess, sessionAuthority, type AdministratorAccessSnapshot } from "@/features/administrator-access/model/administrator-access";
import type { AdministrationDataAccess, AdministrationDirectorySnapshot, AdministrationProjectRow } from "@/features/administration/server/administration-read-model-supabase";
import type { DbNotificationDelivery, DbNotificationEvent } from "../../planning-row-types";

function forbidden() { return { code: "42501", message: "Adminzugang ist nicht mehr gültig." }; }

export async function authorizeAdministrator(input: AdministratorCredentialInput) {
  const startedAt = Date.now();
  const action = input.action;
  if (input.credential.kind !== "session-request" && !(input.credential.kind === "server-cookies" && action === "administration.directory.read")) return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
  let request: NextRequest;
  if (input.credential.kind === "server-cookies") {
    const client = await getServerAuthSupabase();
    const current = client ? await client.auth.getSession() : null;
    if (current?.error || !current?.data.session?.access_token) return { ok: false as const, status: 401, error: "Anmeldung erforderlich." };
    request = { headers: new Headers({ authorization: `Bearer ${current.data.session.access_token}` }), method: "GET" } as NextRequest;
  } else request = input.credential.request;
  const policyAction = action === "administration.technical.update" ? "administration.technical"
    : action === "administration.eligibility.manage" || action === "administration.directory.read" ? "administration.eligibility" : "team.read";
  const permission = await authorizeSessionPolicy(request, policyAction, startedAt);
  if (!permission.ok) return permission;
  const data = permission.data;
  if (!data && (action === "administrator-access.activate" || action === "administrator-access.end")) return { ok: false as const, status: 403, error: "Ein echter Adminzugang ist nur mit einer Benutzersession verfügbar." };
  const profile = permission.profile;
  const authority = "authority" in permission ? permission.authority : undefined;
  const target = "targetProfileId" in input ? input.targetProfileId : "";
  const failure = async () => {
    const result = data ? await data.rpc("administrator_access_snapshot") : null;
    return administratorAccessFailure(currentAdministratorAccess(result?.error ? null : result?.data));
  };
  const currentCapability = async (capability: "manageAdministratorEligibility" | "technicalAdministration") => {
    if (!data || !profile) return forbidden();
    const result = await data.rpc("administrator_access_snapshot");
    if (result.error) return { code: result.error.code === "42501" ? "42501" : "AUTHORIZATION_UNAVAILABLE", message: "Adminzugang konnte nicht geprüft werden." };
    return sessionAuthority({ platformRole: profile.platformRole, credentialKind: "session", administratorAccess: currentAdministratorAccess(result.data) }).capabilities[capability] ? null : forbidden();
  };
  const directory: AdministrationDataAccess = {
    async readDirectory() {
      if (action !== "administration.directory.read") return { data: null, error: forbidden() };
      const denied = await currentCapability("manageAdministratorEligibility");
      if (denied) return { data: null, error: denied };
      return await data!.rpc("administrator_directory_snapshot") as { data: AdministrationDirectorySnapshot | null; error: { code?: string } | null };
    },
    async readNotificationEvents() {
      if (action !== "administration.directory.read") return { data: null, error: forbidden() };
      const denied = await currentCapability("technicalAdministration");
      if (denied) return { data: null, error: denied };
      return await data!.from("notification_events").select("id,type,actor_profile_id,actor_label,recipient_profile_id,entity_type,entity_id,title,body,target_path,status,seen_at,dismissed_at,resolved_at,resolution_reason,created_at").order("created_at", { ascending: false }).limit(100).returns<DbNotificationEvent[]>();
    },
    async readNotificationDeliveries() {
      if (action !== "administration.directory.read") return { data: null, error: forbidden() };
      const denied = await currentCapability("technicalAdministration");
      if (denied) return { data: null, error: denied };
      return await data!.from("notification_deliveries").select("id,event_id,channel,status,attempts,target,payload,last_error,delivered_at,created_at").order("created_at", { ascending: false }).limit(100).returns<DbNotificationDelivery[]>();
    },
    async readProject() {
      if (action !== "administration.directory.read") return { data: null, error: forbidden() };
      const denied = await currentCapability("technicalAdministration");
      if (denied) return { data: null, error: denied };
      return await data!.from("projects").select("id,github_project_owner,github_project_number,github_mention_team_slug").eq("id", "findmydoc-founder-execution").maybeSingle<AdministrationProjectRow>();
    },
  };
  const projectedProfile = profile ? Object.freeze({ ...profile }) : null;
  const projectedAuthority = authority ? Object.freeze({ profile: Object.freeze({ ...authority.profile }), administratorAccess: Object.freeze({ ...authority.administratorAccess }), capabilities: Object.freeze({ ...authority.capabilities }) }) : undefined;
  return { ok: true as const, profile: projectedProfile, authority: projectedAuthority, administrator: {
    async read() {
      if (action !== "administrator-access.read") return { data: null, error: forbidden() };
      if (!data) return { data: inactiveAdministratorAccess, error: null };
      const result = await data.rpc("administrator_access_snapshot");
      return { ...result, data: result.error ? null : currentAdministratorAccess(result.data) };
    },
    async activate() {
      if (action !== "administrator-access.activate" || !data) return { data: null, error: forbidden() };
      return await data.rpc("activate_administrator_access") as { data: AdministratorAccessSnapshot | null; error: { code?: string } | null };
    },
    async end() {
      if (action !== "administrator-access.end" || !data) return { data: null, error: forbidden() };
      return await data.rpc("end_administrator_access") as { data: AdministratorAccessSnapshot | null; error: { code?: string } | null };
    },
    async setEligibility(eligible: boolean) {
      if (action !== "administration.eligibility.manage" || !data) return { data: null, error: forbidden() };
      return await data.rpc("set_administrator_eligibility", { p_profile_id: target, p_eligible: eligible });
    },
    async updateTechnicalIdentity(patch: { github_login?: string | null; google_chat_user_id?: string | null; google_chat_dm_space?: string | null }, metadata: { requestIp?: string | null; userAgent?: string | null }) {
      if (action !== "administration.technical.update" || !data) return { data: null, error: forbidden() };
      return await data.rpc("update_profile_technical_identity_transaction", { p_profile_id: target, p_profile_patch: patch, p_request_ip: metadata.requestIp, p_user_agent: metadata.userAgent });
    },
    directory,
    failure,
  } };
}
