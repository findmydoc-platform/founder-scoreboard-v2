import { GoogleWorkspaceOAuthContractError } from "../../google-calendar-errors";
import { getServerServiceRoleSupabase } from "../../supabase-service-role";
import { createHash } from "node:crypto";
import "server-only";

import {
  GOOGLE_WORKSPACE_CALENDAR_SCOPE,
  GOOGLE_WORKSPACE_PRIMARY_CALENDAR,
  assertGoogleWorkspaceOAuthStateBinding,
  createGoogleWorkspaceOAuthState,
  decryptGoogleWorkspaceToken,
  encryptGoogleWorkspaceToken,
  googleWorkspaceAuthorizationUrl,
  googleWorkspaceConnectionStatus,
  googleWorkspaceEncryptionKey,
  validateGoogleWorkspaceTokenResponse,
  verifyGoogleWorkspaceOAuthState,
  type GoogleWorkspaceConnectionRow,
} from "./google-calendar-protocol";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

type GoogleWorkspaceEnvironment = Readonly<{
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
}>;

export type GoogleWorkspaceVaultRow = GoogleWorkspaceConnectionRow & Readonly<{
  connection_id: string;
  credential_version: number;
  refresh_claim_id: string | null;
  refresh_claim_expires_at: string | null;
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  oauth_scopes: string[];
  token_type: string;
  primary_calendar_id: string;
}>;


function requiredEnvironmentValue(name: string) {
  const value = process.env[name]?.trim() || "";
  if (!value) {
    throw new GoogleWorkspaceOAuthContractError("invalid_configuration", `${name} ist nicht konfiguriert.`);
  }
  return value;
}

export function googleWorkspaceEnvironment(): GoogleWorkspaceEnvironment {
  return {
    clientId: requiredEnvironmentValue("GOOGLE_WORKSPACE_CLIENT_ID"),
    clientSecret: requiredEnvironmentValue("GOOGLE_WORKSPACE_CLIENT_SECRET"),
    encryptionKey: googleWorkspaceEncryptionKey(requiredEnvironmentValue("GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY")),
  };
}

export function createBoundGoogleWorkspaceState(input: {
  userId: string;
  profileId: string;
  next?: string;
}) {
  const { encryptionKey } = googleWorkspaceEnvironment();
  return createGoogleWorkspaceOAuthState({ ...input, key: encryptionKey });
}

export function verifyBoundGoogleWorkspaceState(
  value: string,
  current: { userId: string; profileId: string },
) {
  const { encryptionKey } = googleWorkspaceEnvironment();
  const state = verifyGoogleWorkspaceOAuthState(value, { key: encryptionKey });
  assertGoogleWorkspaceOAuthStateBinding(state, current);
  return state;
}

export function buildGoogleWorkspaceAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
}) {
  const { clientId } = googleWorkspaceEnvironment();
  return googleWorkspaceAuthorizationUrl({ ...input, clientId });
}

async function googleTokenRequest(body: URLSearchParams, classifyInvalidGrant = false) {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const providerError = payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: unknown }).error
      : null;
    throw new GoogleWorkspaceOAuthContractError(
      classifyInvalidGrant && providerError === "invalid_grant"
        ? "provider_revoked"
        : response.status === 400 || response.status === 401
          ? "reconnect_required"
          : "invalid_token_response",
      "Google OAuth konnte nicht abgeschlossen werden.",
    );
  }
  return payload;
}

export async function exchangeGoogleWorkspaceCode(code: string, redirectUri: string) {
  const environment = googleWorkspaceEnvironment();
  const payload = await googleTokenRequest(new URLSearchParams({
    client_id: environment.clientId,
    client_secret: environment.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  }));
  return validateGoogleWorkspaceTokenResponse(payload);
}

export async function probeGoogleWorkspacePrimaryCalendar(accessToken: string) {
  const url = new URL(GOOGLE_CALENDAR_EVENTS_ENDPOINT);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("showDeleted", "false");
  url.searchParams.set("fields", "kind,summary");
  url.searchParams.set("privateExtendedProperty", "founderOpsProbe=__never__");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new GoogleWorkspaceOAuthContractError(
      response.status === 401 || response.status === 403 ? "reconnect_required" : "invalid_token_response",
      "Der primäre Google-Kalender konnte nicht geprüft werden.",
    );
  }
  const body = await response.json().catch(() => null) as { summary?: unknown } | null;
  return typeof body?.summary === "string" ? body.summary.trim().slice(0, 254) || null : null;
}

function isoAfter(seconds: number, now = Date.now()) {
  return new Date(now + seconds * 1000).toISOString();
}

export function calendarVault() {
  const client = getServerServiceRoleSupabase();
  if (!client) throw new GoogleWorkspaceOAuthContractError("invalid_configuration", "Google-Verbindung ist nicht verfügbar.");
  return client;
}
export async function calendarSnapshot(profileId: string) {
  const result = await calendarVault().from("google_workspace_connections")
    .select("connection_id,credential_version,refresh_claim_id,refresh_claim_expires_at,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,oauth_scopes,token_type,primary_calendar_id,connected_at,refreshed_at,last_used_at,revoked_at,last_error_class")
    .eq("profile_id", profileId).maybeSingle<GoogleWorkspaceVaultRow>();
  if (result.error) throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Google-Verbindung ist nicht verfügbar.");
  return result.data;
}
function reconnect() { return new GoogleWorkspaceOAuthContractError("reconnect_required", "Google-Verbindung muss erneuert werden."); }
export async function storeGoogleWorkspaceConnection(profileId: string, token: Awaited<ReturnType<typeof exchangeGoogleWorkspaceCode>>, expected: GoogleWorkspaceVaultRow | null) {
  const { encryptionKey } = googleWorkspaceEnvironment();
  if (!token.refreshToken) throw reconnect();
  const saved = await calendarVault().rpc("store_google_calendar_connection", {
    p_profile_id: profileId, p_expected_connection: expected?.connection_id || null, p_expected_version: expected?.credential_version ?? null,
    p_access: encryptGoogleWorkspaceToken(token.accessToken, encryptionKey), p_refresh: encryptGoogleWorkspaceToken(token.refreshToken, encryptionKey),
    p_access_expires: isoAfter(token.expiresIn), p_refresh_expires: token.refreshTokenExpiresIn ? isoAfter(token.refreshTokenExpiresIn) : null,
  });
  if (saved.error || saved.data !== true) throw reconnect();
}
const refreshing = new Map<string, Promise<string>>();
function configuration() {
  const environment = googleWorkspaceEnvironment();
  return createHash("sha256").update(environment.clientId).update(environment.clientSecret).update(environment.encryptionKey).digest("hex");
}
async function refresh(profileId: string, row: GoogleWorkspaceVaultRow) {
  const binding = configuration(), key = `${binding}:${row.connection_id}:${row.credential_version}`;
  const existing = refreshing.get(key);
  if (existing) return existing;
  const pending = (async () => {
    if (row.refresh_claim_id) {
      if (Date.parse(row.refresh_claim_expires_at || "") <= Date.now()) throw reconnect();
      throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Google-Verbindung wird gerade erneuert.");
    }
    const claim = await calendarVault().rpc("claim_google_calendar_refresh", {p_profile_id:profileId,p_connection_id:row.connection_id,p_version:row.credential_version});
    if (claim.error || !claim.data) throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Google-Verbindung wird gerade erneuert.");
    const environment = googleWorkspaceEnvironment();
    let token: ReturnType<typeof validateGoogleWorkspaceTokenResponse>;
    try {
      const payload = await googleTokenRequest(new URLSearchParams({client_id:environment.clientId,client_secret:environment.clientSecret,refresh_token:decryptGoogleWorkspaceToken(row.encrypted_refresh_token,environment.encryptionKey),grant_type:"refresh_token"}), true);
      token = validateGoogleWorkspaceTokenResponse(payload, {requireRefreshToken:false,allowMissingScope:true});
    } catch (error) {
      const errorClass = error instanceof GoogleWorkspaceOAuthContractError && error.code === "scope_mismatch" ? "oauth_scope_mismatch"
        : error instanceof GoogleWorkspaceOAuthContractError && ["provider_revoked","reconnect_required"].includes(error.code) ? "oauth_reconnect_required" : "oauth_provider_unavailable";
      await calendarVault().rpc("finalize_google_calendar_refresh", {p_profile_id:profileId,p_connection_id:row.connection_id,p_version:row.credential_version,p_claim_id:claim.data,p_access:null,p_refresh:null,p_access_expires:null,p_refresh_expires:null,p_error:errorClass}).then(()=>undefined,()=>undefined);
      throw error instanceof GoogleWorkspaceOAuthContractError ? error : new GoogleWorkspaceOAuthContractError("invalid_token_response", "Google-Verbindung konnte nicht erneuert werden.");
    }
    if (configuration() !== binding) throw reconnect();
    const saved = await calendarVault().rpc("finalize_google_calendar_refresh", {
      p_profile_id:profileId,p_connection_id:row.connection_id,p_version:row.credential_version,p_claim_id:claim.data,
      p_access:encryptGoogleWorkspaceToken(token.accessToken,environment.encryptionKey),
      p_refresh:token.refreshToken ? encryptGoogleWorkspaceToken(token.refreshToken,environment.encryptionKey) : row.encrypted_refresh_token,
      p_access_expires:isoAfter(token.expiresIn),p_refresh_expires:token.refreshTokenExpiresIn ? isoAfter(token.refreshTokenExpiresIn) : row.refresh_token_expires_at,p_error:null,
    });
    if (saved.error || saved.data !== true) throw reconnect();
    return token.accessToken;
  })();
  refreshing.set(key,pending);
  try { return await pending; } finally { refreshing.delete(key); }
}
export async function calendarAccess(profileId: string, expectedConnection: string) {
  const row = await calendarSnapshot(profileId);
  if (!row || row.revoked_at || row.connection_id !== expectedConnection || row.token_type.toLowerCase() !== "bearer" || row.primary_calendar_id !== GOOGLE_WORKSPACE_PRIMARY_CALENDAR || row.oauth_scopes.length !== 1 || row.oauth_scopes[0] !== GOOGLE_WORKSPACE_CALENDAR_SCOPE) throw reconnect();
  if (row.refresh_token_expires_at && Date.parse(row.refresh_token_expires_at) <= Date.now()) throw reconnect();
  if (Date.parse(row.access_token_expires_at) <= Date.now()+60000) return refresh(profileId,row);
  const { encryptionKey } = googleWorkspaceEnvironment();
  const token = decryptGoogleWorkspaceToken(row.encrypted_access_token,encryptionKey);
  const used = await calendarVault().rpc("use_google_calendar_connection", {p_profile_id:profileId,p_connection_id:row.connection_id,p_version:row.credential_version});
  if (used.error || used.data !== true) throw reconnect();
  return token;
}
export async function getGoogleWorkspaceConnectionStatus(profileId: string) {
  const row = await calendarSnapshot(profileId);
  const status = googleWorkspaceConnectionStatus(row);
  if (status.state !== "connected" || !row) return status;
  try { return {...status,calendarLabel:await probeGoogleWorkspacePrimaryCalendar(await calendarAccess(profileId,row.connection_id))}; }
  catch { return {...status,calendarLabel:null}; }
}
