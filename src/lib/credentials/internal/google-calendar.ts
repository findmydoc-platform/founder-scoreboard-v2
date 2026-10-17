import "server-only";
import { GoogleWorkspaceOAuthContractError } from "../../google-calendar-errors";
import { authorizeLegacySession } from "./legacy-session";
import { serverPlanningAuth } from "./server-session-view";
import {
  calendarAccess, calendarSnapshot, calendarVault,
  buildGoogleWorkspaceAuthorizationUrl, createBoundGoogleWorkspaceState,
  exchangeGoogleWorkspaceCode, getGoogleWorkspaceConnectionStatus,
  probeGoogleWorkspacePrimaryCalendar, storeGoogleWorkspaceConnection, verifyBoundGoogleWorkspaceState,
} from "./google-calendar-vault";
import type { GoogleCalendarInput, GoogleCalendarCapability, GoogleCalendarConnectionInput } from "../types";

function denied() { return new GoogleWorkspaceOAuthContractError("reconnect_required", "Gebundene Google-Verbindung ist erforderlich."); }
export async function authorizeGoogleCalendar(input: GoogleCalendarInput) {
  async function owner() {
    const permission = await authorizeLegacySession({credential:input.credential,action:"team.read"});
    if (!permission.ok || permission.profile?.id !== input.target.ownerProfileId) throw denied();
    return permission.profile.id;
  }
  const profileId = await owner();
  if (input.action === "google-calendar.connection.status") return getGoogleWorkspaceConnectionStatus(profileId);
  if (input.action === "google-calendar.connection.remove") {
    const result = await calendarVault().rpc("remove_google_calendar_connection", {p_profile_id:profileId,p_operation_id:input.target.operationId});
    if (result.error || result.data !== true) throw denied();
    return {ok:true as const};
  }
  const snapshot = await calendarSnapshot(profileId);
  if (!snapshot || snapshot.revoked_at) throw denied();
  async function checkDisconnect() {
    if (!input.target.disconnectOperationId) return;
    const operation = await calendarVault().from("google_workspace_disconnect_operations").select("connection_id")
      .eq("id",input.target.disconnectOperationId).eq("owner_profile_id",profileId).in("state",["cleaning","cleanup_pending"]).maybeSingle();
    if (operation.error || operation.data?.connection_id !== snapshot!.connection_id) throw denied();
  }
  await checkDisconnect();
  await calendarAccess(profileId,snapshot.connection_id);
  const calendar: GoogleCalendarCapability = Object.freeze({ async request(value: string | URL, init: RequestInit = {}) {
    const url = new URL(value);
    const headers = new Headers(init.headers);
    const method = init.method || "GET";
    if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com" || url.port || url.username || url.password || url.hash
      || !/^\/calendar\/v3\/calendars\/primary\/events(?:\/[^/]+(?:\/instances)?)?$/.test(url.pathname)
      || !["GET","POST","PUT","PATCH","DELETE"].includes(method) || headers.has("authorization")) throw denied();
    await owner();
    await checkDisconnect();
    const token = await calendarAccess(profileId,snapshot.connection_id);
    headers.set("authorization",`Bearer ${token}`);
    // Credential renewal happens before dispatch. Never replay a Calendar mutation here.
    return fetch(url,{...init,method,headers,cache:"no-store",redirect:"manual"});
  }});
  return {ok:true as const,calendar};
}
export async function authorizeGoogleCalendarConnection(input: GoogleCalendarConnectionInput) {
  const request = input.credential.request;
  const auth = await serverPlanningAuth();
  if (!auth.ok || !auth.profile) throw denied();
  const redirectUri = new URL("/api/google-workspace/callback",request.url).toString();
  if (input.action === "google-calendar.connection.start") {
    const state = createBoundGoogleWorkspaceState({userId:auth.user.id,profileId:auth.profile.id,next:request.nextUrl.searchParams.get("next") || "/team"});
    return {redirect:buildGoogleWorkspaceAuthorizationUrl({redirectUri,state}).toString(),next:"/team"};
  }
  const code = request.nextUrl.searchParams.get("code") || "";
  const value = request.nextUrl.searchParams.get("state") || "";
  if (!code || !value) throw denied();
  const state = verifyBoundGoogleWorkspaceState(value,{userId:auth.user.id,profileId:auth.profile.id});
  const expected = await calendarSnapshot(auth.profile.id);
  const token = await exchangeGoogleWorkspaceCode(code,redirectUri);
  await probeGoogleWorkspacePrimaryCalendar(token.accessToken);
  await storeGoogleWorkspaceConnection(auth.profile.id,token,expected);
  return {next:state.next};
}
