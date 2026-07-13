import { createCipheriv, createDecipheriv, createHmac, createSign, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { githubJson } from "./github-http";
import type { AuthenticatedProfile } from "./types";

const tokenRefreshWindowMs = 5 * 60 * 1000;
const oauthStateTtlMs = 10 * 60 * 1000;

type GitHubAppUserTokenRow = {
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

let cachedInstallationToken: { token: string; expiresAt: number } | null = null;

export class GitHubAppConfigurationError extends Error {}
export class GitHubAppUserTokenRequiredError extends Error {}

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function requireEnv(name: string) {
  const value = env(name);
  if (!value) throw new GitHubAppConfigurationError(`${name} ist nicht gesetzt.`);
  return value;
}

function resolvePrivateKeyPath(value: string) {
  if (value.startsWith("~/")) return `${process.env.HOME || ""}/${value.slice(2)}`;
  return value;
}

async function githubAppPrivateKey() {
  const inline = process.env.GITHUB_APP_PRIVATE_KEY;
  if (inline) return inline.replace(/\\n/g, "\n");
  const keyPath = env("GITHUB_APP_PRIVATE_KEY_PATH");
  if (!keyPath) throw new GitHubAppConfigurationError("GITHUB_APP_PRIVATE_KEY oder GITHUB_APP_PRIVATE_KEY_PATH ist nicht gesetzt.");
  // Keep runtime-only private key files out of Next's static output trace.
  const runtimeImport = Function("specifier", "return import(specifier)") as (specifier: string) => Promise<typeof import("node:fs/promises")>;
  const { readFile } = await runtimeImport("node:fs/promises");
  return readFile(resolvePrivateKeyPath(keyPath), "utf8");
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

function safeRelativeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, "http://localhost");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

async function githubAppJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 540,
    iss: requireEnv("GITHUB_APP_ID"),
  });
  const data = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(data).sign(await githubAppPrivateKey(), "base64url");
  return `${data}.${signature}`;
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
  if (!payload.exp || payload.exp < Date.now()) throw new Error("GitHub OAuth State ist abgelaufen.");
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

export async function getGitHubAppInstallationToken() {
  if (cachedInstallationToken && cachedInstallationToken.expiresAt - Date.now() > tokenRefreshWindowMs) {
    return cachedInstallationToken.token;
  }

  const body = await githubJson<{ token: string; expires_at: string }>(
    `https://api.github.com/app/installations/${encodeURIComponent(requireEnv("GITHUB_APP_INSTALLATION_ID"))}/access_tokens`,
    {
      token: await githubAppJwt(),
      method: "POST",
      operation: "mutation",
      errorMessage: "GitHub-App-Installationstoken konnte nicht erzeugt werden",
    },
  );
  cachedInstallationToken = {
    token: body.token,
    expiresAt: new Date(body.expires_at).getTime(),
  };
  return cachedInstallationToken.token;
}

export async function storeGitHubAppUserToken({
  supabase,
  profile,
  githubUser,
  token,
}: {
  supabase: SupabaseClient;
  profile: AuthenticatedProfile;
  githubUser: GitHubUser;
  token: GitHubAppTokenResponse;
}) {
  if (normalizeLogin(githubUser.login) !== normalizeLogin(profile.githubLogin || "")) {
    throw new Error("GitHub-Verbindung passt nicht zum angemeldeten Teamprofil.");
  }
  if (!token.access_token) throw new Error("GitHub-App-Token fehlt.");

  const now = new Date().toISOString();
  const { error } = await supabase.from("github_app_user_tokens").upsert({
    profile_id: profile.id,
    github_login: githubUser.login,
    github_user_id: githubUser.id,
    encrypted_access_token: encryptToken(token.access_token),
    encrypted_refresh_token: token.refresh_token ? encryptToken(token.refresh_token) : null,
    access_token_expires_at: expiresAtFromNow(token.expires_in),
    refresh_token_expires_at: expiresAtFromNow(token.refresh_token_expires_in),
    connected_at: now,
    refreshed_at: null,
    last_used_at: now,
    revoked_at: null,
    last_error: null,
    updated_at: now,
  }, { onConflict: "profile_id" });

  if (error) throw new Error(`GitHub-App-Verbindung konnte nicht gespeichert werden: ${error.message}`);
}

async function loadTokenRow(supabase: SupabaseClient, profile: AuthenticatedProfile) {
  const { data, error } = await supabase
    .from("github_app_user_tokens")
    .select("profile_id,github_login,github_user_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,connected_at,refreshed_at,last_used_at,revoked_at,last_error")
    .eq("profile_id", profile.id)
    .maybeSingle<GitHubAppUserTokenRow>();

  if (error) throw new Error(`GitHub-App-Verbindung konnte nicht gelesen werden: ${error.message}`);
  return data || null;
}

async function refreshGitHubAppUserToken(supabase: SupabaseClient, profile: AuthenticatedProfile, row: GitHubAppUserTokenRow) {
  if (!row.encrypted_refresh_token || isExpired(row.refresh_token_expires_at)) {
    await supabase.from("github_app_user_tokens").update({
      last_error: "GitHub Refresh Token fehlt oder ist abgelaufen.",
      updated_at: new Date().toISOString(),
    }).eq("profile_id", profile.id);
    throw userTokenRequired("GitHub-Verbindung ist abgelaufen. Bitte verbinde GitHub einmal neu.");
  }

  const token = await exchangeOrRefreshGitHubUserToken(new URLSearchParams({
    client_id: requireEnv("GITHUB_APP_CLIENT_ID"),
    client_secret: requireEnv("GITHUB_APP_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: decryptToken(row.encrypted_refresh_token),
  }));

  const now = new Date().toISOString();
  const { error } = await supabase.from("github_app_user_tokens").update({
    encrypted_access_token: encryptToken(token.access_token || ""),
    encrypted_refresh_token: token.refresh_token ? encryptToken(token.refresh_token) : row.encrypted_refresh_token,
    access_token_expires_at: expiresAtFromNow(token.expires_in),
    refresh_token_expires_at: token.refresh_token_expires_in ? expiresAtFromNow(token.refresh_token_expires_in) : row.refresh_token_expires_at,
    refreshed_at: now,
    last_used_at: now,
    revoked_at: null,
    last_error: null,
    updated_at: now,
  }).eq("profile_id", profile.id);

  if (error) throw new Error(`GitHub-App-Token konnte nicht aktualisiert werden: ${error.message}`);
  return token.access_token || "";
}

export async function getGitHubUserTokenForProfile(supabase: SupabaseClient, profile: AuthenticatedProfile | null) {
  if (!profile?.id || !profile.githubLogin) throw userTokenRequired();
  const row = await loadTokenRow(supabase, profile);
  if (!row || row.revoked_at) throw userTokenRequired();
  if (normalizeLogin(row.github_login) !== normalizeLogin(profile.githubLogin)) {
    throw userTokenRequired("GitHub-Verbindung passt nicht zum angemeldeten Teamprofil. Bitte verbinde GitHub erneut.");
  }
  if (expiresSoon(row.access_token_expires_at)) {
    try {
      return await refreshGitHubAppUserToken(supabase, profile, row);
    } catch (error) {
      if (error instanceof GitHubAppConfigurationError || error instanceof GitHubAppUserTokenRequiredError) throw error;
      await supabase.from("github_app_user_tokens").update({
        last_error: error instanceof Error ? error.message : "GitHub Token konnte nicht erneuert werden.",
        updated_at: new Date().toISOString(),
      }).eq("profile_id", profile.id);
      throw userTokenRequired("GitHub-Verbindung konnte nicht erneuert werden. Bitte verbinde GitHub einmal neu.");
    }
  }

  const token = decryptToken(row.encrypted_access_token);
  await supabase.from("github_app_user_tokens").update({
    last_used_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq("profile_id", profile.id);
  return token;
}

export async function getGitHubUserConnectionStatus(supabase: SupabaseClient, profile: AuthenticatedProfile | null) {
  if (!profile?.id || !profile.githubLogin) {
    return { connected: false, githubLogin: profile?.githubLogin || "", needsReconnect: true, expiresAt: null as string | null };
  }
  const row = await loadTokenRow(supabase, profile);
  if (!row || row.revoked_at || normalizeLogin(row.github_login) !== normalizeLogin(profile.githubLogin)) {
    return { connected: false, githubLogin: profile.githubLogin, needsReconnect: true, expiresAt: null as string | null };
  }

  try {
    if (expiresSoon(row.access_token_expires_at)) {
      await refreshGitHubAppUserToken(supabase, profile, row);
      const refreshed = await loadTokenRow(supabase, profile);
      return {
        connected: true,
        githubLogin: refreshed?.github_login || profile.githubLogin,
        needsReconnect: false,
        expiresAt: refreshed?.access_token_expires_at || null,
      };
    }
  } catch {
    return { connected: false, githubLogin: row.github_login, needsReconnect: true, expiresAt: row.access_token_expires_at };
  }

  return {
    connected: true,
    githubLogin: row.github_login,
    needsReconnect: false,
    expiresAt: row.access_token_expires_at,
  };
}

export async function revokeGitHubAppUserConnection(supabase: SupabaseClient, profile: AuthenticatedProfile | null) {
  if (!profile?.id) return;
  await supabase.from("github_app_user_tokens").delete().eq("profile_id", profile.id);
}
