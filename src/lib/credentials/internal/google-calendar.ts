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
import type { GoogleCalendarInput, GoogleCalendarCapability, GoogleCalendarConnectionInput } from "../types";

function denied() { return new GoogleWorkspaceOAuthContractError("reconnect_required", "Gebundene Google-Verbindung ist erforderlich."); }
export async function authorizeGoogleCalendar(input: GoogleCalendarInput) {
  if (input.credential.kind !== "session-request") throw denied();
  const ownerProfileId = input.target.ownerProfileId;
  const operationId = "operationId" in input.target ? input.target.operationId : undefined;
  const request = input.credential.request;
  async function owner() {
    const permission = await authorizeSessionPolicy(request,"team.read");
    if (!permission.ok || permission.profile?.id !== ownerProfileId || !("assertCurrent" in permission)) throw denied();
    return permission;
  }
  const permission = await owner();
  const profileId = permission.profile.id;
  async function authorizeDispatch(connectionId: string, access: CalendarAccess, configuration: string) {
    const currentAuthority = await owner();
    const current = await calendarSnapshot(profileId);
    if (!current || current.connection_id !== connectionId || current.revoked_at || current.primary_calendar_id !== "primary"
      || current.token_type.toLowerCase() !== "bearer" || current.oauth_scopes.length !== 1 || current.oauth_scopes[0] !== GOOGLE_WORKSPACE_CALENDAR_SCOPE) throw denied();
    const refreshDeadline = current.refresh_token_expires_at ? Date.parse(current.refresh_token_expires_at) : Infinity;
    return () => {
      currentAuthority.assertCurrent();
      if (calendarConfiguration() !== configuration || Date.now() >= Math.min(access.expiresAt,access.refreshExpiresAt,refreshDeadline)) throw denied();
    };
  }
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
  const initial = await calendarAccess(profileId,snapshot.connection_id,configuration);
  const assertInitial = await authorizeDispatch(snapshot.connection_id,initial,configuration);
  assertInitial();
  const calendar: GoogleCalendarCapability = Object.freeze({ async request(value: string | URL, init: NonNullable<Parameters<GoogleCalendarCapability["request"]>[1]> = {}) {
    const url = new URL(value);
    const { allowedStatuses: requestedStatuses, ...options } = init;
    const absenceStatuses = requestedStatuses?.filter(status => status === 404 || status === 410);
    const headers = new Headers(options.headers);
    const method = options.method || "GET";
    if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com" || url.port || url.username || url.password || url.hash
      || !/^\/calendar\/v3\/calendars\/primary\/events(?:\/[^/]+(?:\/instances)?)?$/.test(url.pathname)
      || !["GET","POST","PUT","PATCH","DELETE"].includes(method) || headers.has("authorization")) throw denied();
    await owner();
    const access = await calendarAccess(profileId,snapshot.connection_id,configuration);
    headers.set("authorization",`Bearer ${access.token}`);
    const assertCurrent = await authorizeDispatch(snapshot.connection_id,access,configuration);
    assertCurrent();
    // Every resource attempt re-enters this transport. Credential renewal never replays a mutation.
    const allowedStatuses = ["GET", "DELETE"].includes(method) && /^\/calendar\/v3\/calendars\/primary\/events\/[^/]+$/.test(url.pathname) ? absenceStatuses : undefined;
    return observedProviderFetch(method === "GET" ? "google.calendar.read" : "google.calendar.mutation", url,{...options,method,headers,cache:"no-store",redirect:"manual"}, allowedStatuses);
  }});
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
