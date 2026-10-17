import "server-only";
import { safeRelativeNext } from "../../auth-redirect";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerServiceRoleSupabase } from "../../supabase-service-role";
import { githubJson } from "../../github-http";
import type { AuthenticatedProfile } from "../../types";

const tokenRefreshWindowMs = 5 * 60 * 1000;
const oauthStateTtlMs = 10 * 60 * 1000;

type GitHubAppUserTokenRow = {
  connection_id: string; credential_version: number; refresh_claim_id: string | null; refresh_claim_expires_at: string | null;
  profile_id: string;
  github_login: string;
  github_user_id: number | null;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  connected_at: string;
  refreshed_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  last_error: string | null;
};

type GitHubAppTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
};

type GitHubUser = {
  id: number;
  login: string;
};

type OAuthStatePayload = {
  userId: string;
  profileId: string;
  next: string;
  exp: number;
  nonce: string;
};

import { GitHubAppConfigurationError } from "../../github-app-errors";
import { GitHubAppUserTokenRequiredError, GitHubAppUserTokenBusyError } from "../../github-app-errors";


function env(name: string) {
  return process.env[name]?.trim() || "";
}

function requireEnv(name: string) {
  const value = env(name);
  if (!value) throw new GitHubAppConfigurationError(`${name} ist nicht gesetzt.`);
  return value;
}

function tokenEncryptionKey() {
  const decoded = Buffer.from(requireEnv("GITHUB_TOKEN_ENCRYPTION_KEY"), "base64");
  if (decoded.length !== 32) {
    throw new GitHubAppConfigurationError("GITHUB_TOKEN_ENCRYPTION_KEY muss als Base64-Wert exakt 32 Byte ergeben.");
  }
  return decoded;
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decryptToken(value: string) {
  const [ivValue, tagValue, ciphertextValue] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Gespeicherter GitHub Token ist ungültig.");
  const decipher = createDecipheriv("aes-256-gcm", tokenEncryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function expiresAtFromNow(seconds?: number) {
  return seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;
}

function expiresSoon(value?: string | null) {
  if (!value) return false;
  return new Date(value).getTime() - Date.now() < tokenRefreshWindowMs;
}

function isExpired(value?: string | null) {
  return Boolean(value && new Date(value).getTime() <= Date.now());
}

function normalizeLogin(value: string) {
  return value.trim().toLowerCase();
}

function userTokenRequired(message = "GitHub-App-Verbindung fehlt. Bitte verbinde GitHub einmal neu.") {
  return new GitHubAppUserTokenRequiredError(message);
}

async function exchangeOrRefreshGitHubUserToken(params: URLSearchParams) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const body = await response.json().catch(() => null) as GitHubAppTokenResponse | null;
  if (!response.ok || !body?.access_token || body.error) {
    const detail = body?.error_description || body?.error || `HTTP ${response.status}`;
    throw new Error(`GitHub-App-Token konnte nicht erzeugt werden: ${detail}`);
  }
  return body;
}

export function createGitHubAppOAuthState({ userId, profileId, next }: { userId: string; profileId: string; next: string }) {
  const payload: OAuthStatePayload = {
    userId,
    profileId,
    next: safeRelativeNext(next),
    exp: Date.now() + oauthStateTtlMs,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encoded = base64UrlJson(payload);
  const signature = createHmac("sha256", tokenEncryptionKey()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyGitHubAppOAuthState(state: string) {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) throw new Error("GitHub OAuth State ist ungültig.");
  const expected = createHmac("sha256", tokenEncryptionKey()).update(encoded).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) {
    throw new Error("GitHub OAuth State konnte nicht geprüft werden.");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthStatePayload;
  if (!payload.exp || payload.exp <= Date.now()) throw new Error("GitHub OAuth State ist abgelaufen.");
  return payload;
}

export function githubAppAuthorizationUrl({ state, redirectUri }: { state: string; redirectUri: string }) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", requireEnv("GITHUB_APP_CLIENT_ID"));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeGitHubAppCode(code: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id: requireEnv("GITHUB_APP_CLIENT_ID"),
    client_secret: requireEnv("GITHUB_APP_CLIENT_SECRET"),
    code,
    redirect_uri: redirectUri,
  });
  return exchangeOrRefreshGitHubUserToken(params);
}

export async function githubUserForAppUserToken(token: string) {
  return githubJson<GitHubUser>("https://api.github.com/user", {
    token,
    errorMessage: "GitHub-Benutzer konnte nicht geladen werden",
  });
}

export async function storeGitHubAppUserToken({
  supabase,
  profile,
  githubUser,
  token,
  expected,
}: {
  supabase: SupabaseClient;
  profile: AuthenticatedProfile;
  githubUser: GitHubUser;
  token: GitHubAppTokenResponse;
  expected: {connection_id:string;credential_version:number}|null;
}) {
  const configuredLogin = await loadConfiguredGitHubLogin(supabase, profile.id);
  if (!configuredLogin || normalizeLogin(githubUser.login) !== normalizeLogin(configuredLogin)) {
    throw new Error("GitHub-Verbindung passt nicht zum angemeldeten Teamprofil.");
  }
  if (!token.access_token) throw new Error("GitHub-App-Token fehlt.");

  const stored = await supabase.rpc("store_github_user_connection", {
    p_expected_connection: expected?.connection_id || null, p_expected_version: expected?.credential_version ?? null,
    p_profile_id: profile.id, p_github_login: githubUser.login, p_github_user_id: githubUser.id,
    p_access: encryptToken(token.access_token), p_refresh: token.refresh_token ? encryptToken(token.refresh_token) : null,
    p_access_expires: expiresAtFromNow(token.expires_in), p_refresh_expires: expiresAtFromNow(token.refresh_token_expires_in),
  });
  if (stored.error || stored.data !== true) throw new Error("GitHub-App-Verbindung konnte nicht gespeichert werden.");
}

async function loadTokenRow(supabase: SupabaseClient, profile: AuthenticatedProfile) {
  const { data, error } = await supabase
    .from("github_app_user_tokens")
    .select("connection_id,credential_version,refresh_claim_id,refresh_claim_expires_at,profile_id,github_login,github_user_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,connected_at,refreshed_at,last_used_at,revoked_at,last_error")
    .eq("profile_id", profile.id)
    .maybeSingle<GitHubAppUserTokenRow>();

  if (error) throw new Error(`GitHub-App-Verbindung konnte nicht gelesen werden: ${error.message}`);
  return data || null;
}

async function loadConfiguredGitHubLogin(supabase: SupabaseClient, profileId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("github_login")
    .eq("id", profileId)
    .maybeSingle<{ github_login: string | null }>();

  if (error) throw new Error(`Technische GitHub-Zuordnung konnte nicht gelesen werden: ${error.message}`);
  return data?.github_login?.trim() || "";
}

const refreshing = new Map<string, Promise<string>>();

async function refreshGitHubAppUserToken(supabase: SupabaseClient, profile: AuthenticatedProfile, row: GitHubAppUserTokenRow) {
  const configuration = createHash("sha256").update(JSON.stringify([requireEnv("GITHUB_APP_CLIENT_ID"),requireEnv("GITHUB_APP_CLIENT_SECRET"),requireEnv("GITHUB_TOKEN_ENCRYPTION_KEY")])).digest("hex");
  const key = `${configuration}:${row.connection_id}:${row.credential_version}`;
  const existing = refreshing.get(key);
  if (existing) return existing;
  const operation = (async () => {
    if (row.refresh_claim_id) {
      if (Date.parse(row.refresh_claim_expires_at || "") <= Date.now()) throw userTokenRequired();
      throw new GitHubAppUserTokenBusyError("GitHub-Verbindung wird gerade erneuert. Bitte später erneut versuchen.");
    }
    if (!row.encrypted_refresh_token || isExpired(row.refresh_token_expires_at)) throw userTokenRequired("GitHub-Verbindung ist abgelaufen. Bitte verbinde GitHub einmal neu.");
    const claim = await supabase.rpc("claim_github_user_refresh", {
      p_profile_id: profile.id, p_connection_id: row.connection_id, p_version: row.credential_version,
    });
    if (claim.error) throw new Error("GitHub-Verbindung konnte nicht reserviert werden.");
    if (!claim.data) throw new GitHubAppUserTokenBusyError("GitHub-Verbindung wird gerade erneuert. Bitte später erneut versuchen.");
    let token: GitHubAppTokenResponse;
    try {
      token = await exchangeOrRefreshGitHubUserToken(new URLSearchParams({
        client_id: requireEnv("GITHUB_APP_CLIENT_ID"), client_secret: requireEnv("GITHUB_APP_CLIENT_SECRET"),
        grant_type: "refresh_token", refresh_token: decryptToken(row.encrypted_refresh_token),
      }));
    } catch {
      // A consumed rotating refresh token cannot be recovered after an unknown provider outcome.
      // Retain the durable claim. No instance may exchange this snapshot again.
      await supabase.rpc("finalize_github_user_refresh", {
        p_profile_id: profile.id, p_connection_id: row.connection_id, p_version: row.credential_version,
        p_claim_id: claim.data, p_access: null, p_refresh: null, p_access_expires: null, p_refresh_expires: null,
      }).then(() => undefined, () => undefined);
      throw userTokenRequired("GitHub-Verbindung konnte nicht erneuert werden. Bitte verbinde GitHub einmal neu.");
    }
    const currentConfiguration = createHash("sha256").update(JSON.stringify([requireEnv("GITHUB_APP_CLIENT_ID"),requireEnv("GITHUB_APP_CLIENT_SECRET"),requireEnv("GITHUB_TOKEN_ENCRYPTION_KEY")])).digest("hex");
    if(currentConfiguration!==configuration) throw userTokenRequired("GitHub-Konfiguration wurde geändert. Bitte erneut verbinden.");
    const saved = await supabase.rpc("finalize_github_user_refresh", {
      p_profile_id: profile.id, p_connection_id: row.connection_id, p_version: row.credential_version,
      p_claim_id: claim.data, p_access: encryptToken(token.access_token || ""),
      p_refresh: token.refresh_token ? encryptToken(token.refresh_token) : row.encrypted_refresh_token,
      p_access_expires: expiresAtFromNow(token.expires_in),
      p_refresh_expires: token.refresh_token_expires_in ? expiresAtFromNow(token.refresh_token_expires_in) : row.refresh_token_expires_at,
    });
    if (saved.error || saved.data !== true) throw userTokenRequired("GitHub-Verbindung wurde geändert. Bitte erneut verbinden.");
    return token.access_token || "";
  })();
  refreshing.set(key, operation);
  try { return await operation; } finally { refreshing.delete(key); }
}

export async function getGitHubUserTokenForProfile(supabase: SupabaseClient, profile: AuthenticatedProfile | null) {
  if (!profile?.id) throw userTokenRequired();
  const configuredLogin = await loadConfiguredGitHubLogin(supabase, profile.id);
  if (!configuredLogin) throw userTokenRequired();
  const row = await loadTokenRow(supabase, profile);
  if (!row || row.revoked_at) throw userTokenRequired();
  if (normalizeLogin(row.github_login) !== normalizeLogin(configuredLogin)) {
    throw userTokenRequired("GitHub-Verbindung passt nicht zum angemeldeten Teamprofil. Bitte verbinde GitHub erneut.");
  }
  if (expiresSoon(row.access_token_expires_at)) return refreshGitHubAppUserToken(supabase, profile, row);

  const token = decryptToken(row.encrypted_access_token);
  const used = await supabase.rpc("use_github_user_connection", {
    p_profile_id: profile.id, p_connection_id: row.connection_id, p_version: row.credential_version, p_disconnect: false,
  });
  if (used.error || used.data !== true) throw userTokenRequired();
  return token;
}

export async function getGitHubUserConnectionStatus(supabase: SupabaseClient, profile: AuthenticatedProfile | null) {
  if (!profile?.id) return { connected: false, needsReconnect: true, expiresAt: null as string | null };
  const configuredLogin = await loadConfiguredGitHubLogin(supabase, profile.id);
  if (!configuredLogin) return { connected: false, needsReconnect: true, expiresAt: null as string | null };
  const row = await loadTokenRow(supabase, profile);
  if (!row || row.revoked_at || normalizeLogin(row.github_login) !== normalizeLogin(configuredLogin)) {
    return { connected: false, needsReconnect: true, expiresAt: null as string | null };
  }

  try {
    if (expiresSoon(row.access_token_expires_at)) {
      await refreshGitHubAppUserToken(supabase, profile, row);
      const refreshed = await loadTokenRow(supabase, profile);
      return {
        connected: true,
        needsReconnect: false,
        expiresAt: refreshed?.access_token_expires_at || null,
      };
    }
  } catch {
    return { connected: false, needsReconnect: true, expiresAt: row.access_token_expires_at };
  }

  return {
    connected: true,
    needsReconnect: false,
    expiresAt: row.access_token_expires_at,
  };
}

export async function revokeGitHubAppUserConnection(supabase: SupabaseClient, profile: AuthenticatedProfile | null) {
  if (!profile?.id) return;
  const row = await loadTokenRow(supabase, profile);
  if (!row) return;
  const result = await supabase.rpc("use_github_user_connection", { p_profile_id: profile.id,
    p_connection_id: row.connection_id, p_version: row.credential_version, p_disconnect: true });
  if (result.error) throw new Error("GitHub-Verbindung konnte nicht getrennt werden.");
}

export function userVault() {
  const supabase = getServerServiceRoleSupabase();
  if (!supabase) throw new GitHubAppConfigurationError("Supabase Service Role ist nicht konfiguriert.");
  return supabase;
}
export async function boundUserConnection(profileId: string) {
  const profile = { id: profileId } as AuthenticatedProfile;
  const supabase = userVault();
  const configured = await loadConfiguredGitHubLogin(supabase, profileId);
  const row = await loadTokenRow(supabase, profile);
  if (!configured || !row || row.revoked_at || normalizeLogin(configured) !== normalizeLogin(row.github_login)) throw userTokenRequired();
  return row;
}

export async function oauthConnectionSnapshot(profile:AuthenticatedProfile) {
  const row=await loadTokenRow(userVault(),profile);
  return row ? {connection_id:row.connection_id,credential_version:row.credential_version} : null;
}
