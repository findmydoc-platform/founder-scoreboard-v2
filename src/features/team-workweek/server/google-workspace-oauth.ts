import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GOOGLE_WORKSPACE_CALENDAR_SCOPE,
  GOOGLE_WORKSPACE_PRIMARY_CALENDAR,
  GoogleWorkspaceOAuthContractError,
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
} from "./google-workspace-oauth-core";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_REVOCATION_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const GOOGLE_CALENDAR_EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

type GoogleWorkspaceEnvironment = Readonly<{
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
}>;

type GoogleWorkspaceVaultRow = GoogleWorkspaceConnectionRow & Readonly<{
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  oauth_scopes: string[];
  token_type: string;
  primary_calendar_id: string;
}>;

const STATUS_COLUMNS = "connected_at,refreshed_at,last_used_at,access_token_expires_at,refresh_token_expires_at,revoked_at,last_error_class";

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

async function googleTokenRequest(body: URLSearchParams) {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    throw new GoogleWorkspaceOAuthContractError(
      response.status === 400 || response.status === 401 ? "reconnect_required" : "invalid_token_response",
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
  url.searchParams.set("fields", "kind");
  url.searchParams.set("privateExtendedProperty", "founderOpsProbe=__never__");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new GoogleWorkspaceOAuthContractError(
      response.status === 401 || response.status === 403 ? "reconnect_required" : "invalid_token_response",
      "Der primäre Google-Kalender konnte nicht geprüft werden.",
    );
  }
}

function isoAfter(seconds: number, now = Date.now()) {
  return new Date(now + seconds * 1000).toISOString();
}

export async function storeGoogleWorkspaceConnection({
  supabase,
  profileId,
  token,
  now = Date.now(),
}: {
  supabase: SupabaseClient;
  profileId: string;
  token: Awaited<ReturnType<typeof exchangeGoogleWorkspaceCode>>;
  now?: number;
}) {
  if (!token.refreshToken) {
    throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Google OAuth Refresh Token fehlt.");
  }
  const { encryptionKey } = googleWorkspaceEnvironment();
  const connectedAt = new Date(now).toISOString();
  const { error } = await supabase.from("google_workspace_connections").upsert({
    profile_id: profileId,
    encrypted_access_token: encryptGoogleWorkspaceToken(token.accessToken, encryptionKey),
    encrypted_refresh_token: encryptGoogleWorkspaceToken(token.refreshToken, encryptionKey),
    access_token_expires_at: isoAfter(token.expiresIn, now),
    refresh_token_expires_at: token.refreshTokenExpiresIn ? isoAfter(token.refreshTokenExpiresIn, now) : null,
    oauth_scopes: [GOOGLE_WORKSPACE_CALENDAR_SCOPE],
    token_type: token.tokenType,
    primary_calendar_id: GOOGLE_WORKSPACE_PRIMARY_CALENDAR,
    connected_at: connectedAt,
    refreshed_at: null,
    last_used_at: null,
    revoked_at: null,
    last_error_class: null,
    updated_at: connectedAt,
  }, { onConflict: "profile_id" });
  if (error) {
    throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Google-Verbindung konnte nicht gespeichert werden.");
  }
}

export async function getGoogleWorkspaceConnectionStatus(supabase: SupabaseClient, profileId: string) {
  const { data, error } = await supabase
    .from("google_workspace_connections")
    .select(STATUS_COLUMNS)
    .eq("profile_id", profileId)
    .maybeSingle<GoogleWorkspaceConnectionRow>();
  if (error) {
    throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Google-Verbindungsstatus ist nicht verfügbar.");
  }
  return googleWorkspaceConnectionStatus(data || null);
}

async function markGoogleWorkspaceConnectionError(
  supabase: SupabaseClient,
  profileId: string,
  errorClass: "oauth_reconnect_required" | "oauth_provider_unavailable" | "oauth_scope_mismatch" | "oauth_storage_failed",
) {
  await supabase.from("google_workspace_connections").update({
    last_error_class: errorClass,
    updated_at: new Date().toISOString(),
  }).eq("profile_id", profileId);
}

export async function refreshGoogleWorkspaceAccessToken({
  supabase,
  profileId,
  row,
  now = Date.now(),
}: {
  supabase: SupabaseClient;
  profileId: string;
  row: GoogleWorkspaceVaultRow;
  now?: number;
}) {
  const environment = googleWorkspaceEnvironment();
  const refreshToken = decryptGoogleWorkspaceToken(row.encrypted_refresh_token, environment.encryptionKey);
  const payload = await googleTokenRequest(new URLSearchParams({
    client_id: environment.clientId,
    client_secret: environment.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }));
  const token = validateGoogleWorkspaceTokenResponse(payload, { requireRefreshToken: false, allowMissingScope: true });
  const refreshedAt = new Date(now).toISOString();
  const { error } = await supabase.from("google_workspace_connections").update({
    encrypted_access_token: encryptGoogleWorkspaceToken(token.accessToken, environment.encryptionKey),
    access_token_expires_at: isoAfter(token.expiresIn, now),
    refreshed_at: refreshedAt,
    last_error_class: null,
    updated_at: refreshedAt,
  }).eq("profile_id", profileId);
  if (error) {
    throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Aktualisierter Google OAuth Token konnte nicht gespeichert werden.");
  }
  return token.accessToken;
}

export async function getGoogleWorkspaceAccessToken(
  supabase: SupabaseClient,
  profileId: string,
  now = Date.now(),
) {
  const { data, error } = await supabase
    .from("google_workspace_connections")
    .select("encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,oauth_scopes,token_type,primary_calendar_id,connected_at,refreshed_at,last_used_at,revoked_at,last_error_class")
    .eq("profile_id", profileId)
    .maybeSingle<GoogleWorkspaceVaultRow>();
  if (error || !data || data.revoked_at) {
    throw new GoogleWorkspaceOAuthContractError("reconnect_required", "Google-Verbindung muss erneuert werden.");
  }
  const refreshExpired = data.refresh_token_expires_at && new Date(data.refresh_token_expires_at).getTime() <= now;
  if (refreshExpired) {
    await markGoogleWorkspaceConnectionError(supabase, profileId, "oauth_reconnect_required");
    throw new GoogleWorkspaceOAuthContractError("reconnect_required", "Google-Verbindung muss erneuert werden.");
  }
  if (new Date(data.access_token_expires_at).getTime() <= now + 60_000) {
    try {
      return await refreshGoogleWorkspaceAccessToken({ supabase, profileId, row: data, now });
    } catch (error) {
      const errorClass = error instanceof GoogleWorkspaceOAuthContractError
        ? error.code === "scope_mismatch"
          ? "oauth_scope_mismatch"
          : error.code === "reconnect_required"
            ? "oauth_reconnect_required"
            : "oauth_provider_unavailable"
        : "oauth_provider_unavailable";
      await markGoogleWorkspaceConnectionError(supabase, profileId, errorClass);
      throw error;
    }
  }
  const { encryptionKey } = googleWorkspaceEnvironment();
  try {
    return decryptGoogleWorkspaceToken(data.encrypted_access_token, encryptionKey);
  } catch (error) {
    await markGoogleWorkspaceConnectionError(supabase, profileId, "oauth_reconnect_required");
    throw error;
  }
}

export async function revokeAndRemoveGoogleWorkspaceConnection(
  supabase: SupabaseClient,
  profileId: string,
) {
  const { data, error } = await supabase
    .from("google_workspace_connections")
    .select("encrypted_refresh_token")
    .eq("profile_id", profileId)
    .maybeSingle<{ encrypted_refresh_token: string }>();
  if (error) {
    throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Google-Verbindung konnte nicht geladen werden.");
  }
  if (!data) return;

  const revokedAt = new Date().toISOString();
  const { error: revokeIntentError } = await supabase
    .from("google_workspace_connections")
    .update({
      revoked_at: revokedAt,
      last_error_class: "oauth_reconnect_required",
      updated_at: revokedAt,
    })
    .eq("profile_id", profileId);
  if (revokeIntentError) {
    throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Google-Widerruf konnte nicht vorbereitet werden.");
  }

  const { encryptionKey } = googleWorkspaceEnvironment();
  const refreshToken = decryptGoogleWorkspaceToken(data.encrypted_refresh_token, encryptionKey);
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_REVOCATION_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
      cache: "no-store",
    });
  } catch {
    await markGoogleWorkspaceConnectionError(supabase, profileId, "oauth_provider_unavailable");
    throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Google-Widerruf konnte nicht bestätigt werden.");
  }
  if (!response.ok && response.status !== 400) {
    await markGoogleWorkspaceConnectionError(supabase, profileId, "oauth_provider_unavailable");
    throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Google-Verbindung konnte nicht widerrufen werden.");
  }

  const { error: deleteError } = await supabase
    .from("google_workspace_connections")
    .delete()
    .eq("profile_id", profileId);
  if (deleteError) {
    throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Widerrufene Google-Verbindung konnte nicht entfernt werden.");
  }
}
