import { observedProviderFetch } from "./observed-fetch";
import "server-only";
import { GoogleWorkspaceOAuthContractError } from "../../google-calendar-errors";
import { authorizeSessionPolicy } from "./session-policy";
import { serverPlanningContext } from "./server-session-view";
import {
  calendarAccess, calendarConfiguration, calendarSnapshot, calendarVault,
  buildGoogleWorkspaceAuthorizationUrl, createBoundGoogleWorkspaceState,
  exchangeGoogleWorkspaceCode, getGoogleWorkspaceConnectionStatus,
  probeGoogleWorkspacePrimaryCalendar, storeGoogleWorkspaceConnection, verifyBoundGoogleWorkspaceState,
  type CalendarAccess,
} from "./google-calendar-vault";
import { GOOGLE_WORKSPACE_CALENDAR_SCOPE } from "./google-calendar-protocol";
import type { NextRequest } from "next/server";
import type { GoogleCalendarInput, GoogleCalendarCapability, GoogleCalendarConnectionInput, GoogleCalendarMutation } from "../types";

function denied() { return new GoogleWorkspaceOAuthContractError("reconnect_required", "Gebundene Google-Verbindung ist erforderlich."); }
function calendarOwner(request: NextRequest, ownerProfileId: string) {
  return async () => {
    const permission = await authorizeSessionPolicy(request,"team.read");
    if (!permission.ok || permission.profile?.id !== ownerProfileId || !("assertCurrent" in permission)) throw denied();
    return permission;
  };
}
function calendarDispatch(owner: ReturnType<typeof calendarOwner>, profileId: string) {
  return async (connectionId: string, access: CalendarAccess, configuration: string) => {
    const currentAuthority = await owner();
    const current = await calendarSnapshot(profileId);
    if (!current || current.connection_id !== connectionId || current.revoked_at || current.primary_calendar_id !== "primary"
      || current.token_type.toLowerCase() !== "bearer" || current.oauth_scopes.length !== 1 || current.oauth_scopes[0] !== GOOGLE_WORKSPACE_CALENDAR_SCOPE) throw denied();
    const refreshDeadline = current.refresh_token_expires_at ? Date.parse(current.refresh_token_expires_at) : Infinity;
    return () => {
      currentAuthority.assertCurrent();
      if (calendarConfiguration() !== configuration || Date.now() >= Math.min(access.expiresAt,access.refreshExpiresAt,refreshDeadline)) throw denied();
    };
  };
}
export async function boundGoogleConnectionStatus(context: {
  request: NextRequest;
  profile: { id: string };
  current(): Promise<void>;
  assertCurrent(): void;
}) {
  // Reuse admission evidence, but revalidate its live binding before raw vault access.
  await context.current();
  context.assertCurrent();
  const owner = calendarOwner(context.request, context.profile.id);
  return getGoogleWorkspaceConnectionStatus(context.profile.id, calendarDispatch(owner, context.profile.id));
}
export async function authorizeGoogleCalendar(input: GoogleCalendarInput) {
  if (input.credential.kind !== "session-request") throw denied();
  const ownerProfileId = input.target.ownerProfileId;
  const operationId = "operationId" in input.target ? input.target.operationId : undefined;
  const request = input.credential.request;
  const owner = calendarOwner(request, ownerProfileId);
  const permission = await owner();
  const profileId = permission.profile.id;
  const authorizeDispatch = calendarDispatch(owner, profileId);
  if (input.action === "google-calendar.connection.status") return getGoogleWorkspaceConnectionStatus(profileId,authorizeDispatch);
  if (input.action === "google-calendar.connection.remove") {
    permission.assertCurrent();
    const result = await calendarVault().rpc("remove_google_calendar_connection", {p_profile_id:profileId,p_operation_id:operationId});
    if (result.error || result.data !== true) throw denied();
    return {ok:true as const};
  }
  const configuration = calendarConfiguration();
  const snapshot = await calendarSnapshot(profileId);
  if (!snapshot || snapshot.revoked_at) throw denied();
  const connectionId = snapshot.connection_id;
  const initial = await calendarAccess(profileId,connectionId,configuration);
  const assertInitial = await authorizeDispatch(connectionId,initial,configuration);
  assertInitial();
  async function dispatch(value: string | URL, init: NonNullable<Parameters<GoogleCalendarCapability["request"]>[1]> = {}, binding?: GoogleCalendarMutation) {
    const url = new URL(value);
    const { allowedStatuses: requestedStatuses, ...options } = init;
    const absenceStatuses = requestedStatuses?.filter(status => status === 404 || status === 410);
    const headers = new Headers(options.headers);
    const method = options.method || "GET";
    if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com" || url.port || url.username || url.password || url.hash
      || !/^\/calendar\/v3\/calendars\/primary\/events(?:\/[^/]+(?:\/instances)?)?$/.test(url.pathname)
      || !(binding ? ["POST","PUT","DELETE"] : ["GET"]).includes(method) || headers.has("authorization")) throw denied();
    await owner();
    const access = await calendarAccess(profileId,connectionId,configuration);
    headers.set("authorization",`Bearer ${access.token}`);
    const assertCurrent = await authorizeDispatch(connectionId,access,configuration);
    assertCurrent();
    if (binding) {
      const eventId = method === "POST" ? JSON.parse(String(options.body || "null"))?.id : decodeURIComponent(url.pathname.split("/").at(-1)!);
      if (typeof eventId !== "string" || !eventId || (method === "POST" && !url.pathname.endsWith("/events"))) throw denied();
      if (method !== "POST" && !/^\/calendar\/v3\/calendars\/primary\/events\/[^/]+$/.test(url.pathname)) throw denied();
      const prepared = await calendarVault().rpc("dispatch_google_calendar_mutation", {
        p_owner_profile_id: profileId, p_kind: binding.kind, p_operation_id: binding.operationId,
        p_target_id: binding.targetId, p_event_id: eventId, p_method: method, p_replay: Boolean(binding.replay),
      });
      if (prepared.error || prepared.data !== true) throw denied();
      assertCurrent();
    }
    // Every resource attempt re-enters this transport. Credential renewal never replays a mutation.
    const allowedStatuses = ["GET", "DELETE"].includes(method) && /^\/calendar\/v3\/calendars\/primary\/events\/[^/]+$/.test(url.pathname) ? absenceStatuses : undefined;
    return observedProviderFetch(method === "GET" ? "google.calendar.read" : "google.calendar.mutation", url,{...options,method,headers,cache:"no-store",redirect:"manual"}, allowedStatuses);
  }
  const calendar: GoogleCalendarCapability = Object.freeze({
    request: (url, init) => dispatch(url, init),
    mutate: (binding, url, init) => dispatch(url, init, binding),
  });
  assertInitial();
  return {ok:true as const,calendar};
}
export async function authorizeGoogleCalendarConnection(input: GoogleCalendarConnectionInput) {
  if (input.credential.kind !== "google-calendar-oauth-request") throw denied();
  const request = input.credential.request;
  const auth = await serverPlanningContext();
  if (!auth.ok || !auth.profile) throw denied();
  const configuration = calendarConfiguration();
  const redirectUri = new URL("/api/google-workspace/callback",request.url).toString();
  if (input.action === "google-calendar.connection.start") {
    const state = createBoundGoogleWorkspaceState({userId:auth.user.id,profileId:auth.profile.id,next:request.nextUrl.searchParams.get("next") || "/team"});
    auth.assertCurrent();
    return {redirect:buildGoogleWorkspaceAuthorizationUrl({redirectUri,state}).toString(),next:"/team"};
  }
  const code = request.nextUrl.searchParams.get("code") || "";
  const value = request.nextUrl.searchParams.get("state") || "";
  if (!code || !value) throw denied();
  const state = verifyBoundGoogleWorkspaceState(value,{userId:auth.user.id,profileId:auth.profile.id});
  const assertCurrent = () => {
    auth.assertCurrent();
    if (calendarConfiguration() !== configuration || Date.now() >= state.exp) throw denied();
  };
  const expected = await calendarSnapshot(auth.profile.id);
  const token = await exchangeGoogleWorkspaceCode(code,redirectUri,configuration,assertCurrent);
  const assertToken = () => { assertCurrent(); if (Date.now() >= token.issuedAt + token.expiresIn * 1000) throw denied(); };
  await probeGoogleWorkspacePrimaryCalendar(token.accessToken,async () => {
    const current = await serverPlanningContext();
    if (!current.ok || current.profile.id !== auth.profile.id || current.user.id !== auth.user.id) throw denied();
    return () => { current.assertCurrent(); assertToken(); };
  });
  const current = await serverPlanningContext();
  if (!current.ok || current.profile.id !== auth.profile.id || current.user.id !== auth.user.id) throw denied();
  current.assertCurrent();
  await storeGoogleWorkspaceConnection(auth.profile.id,token,expected,configuration,assertToken);
  return {next:state.next};
}
