import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { GoogleWorkspaceConnectionStatus } from "../model/google-workspace-connection";

export const GOOGLE_WORKSPACE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
export const GOOGLE_WORKSPACE_PRIMARY_CALENDAR = "primary";
export const GOOGLE_WORKSPACE_STATE_TTL_MS = 10 * 60 * 1000;

export type GoogleWorkspaceOAuthState = Readonly<{
  userId: string;
  profileId: string;
  next: string;
  exp: number;
  nonce: string;
}>;

export type GoogleWorkspaceTokenResponse = Readonly<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  refreshTokenExpiresIn: number | null;
  scope: string[];
  tokenType: "Bearer";
}>;

export type GoogleWorkspaceConnectionRow = Readonly<{
  connected_at: string;
  refreshed_at: string | null;
  last_used_at: string | null;
  access_token_expires_at: string;
  refresh_token_expires_at: string | null;
  revoked_at: string | null;
  last_error_class: string | null;
}>;

export class GoogleWorkspaceOAuthContractError extends Error {
  readonly code:
    | "invalid_configuration"
    | "invalid_state"
    | "expired_state"
    | "state_binding_mismatch"
    | "invalid_token_response"
    | "scope_mismatch"
    | "provider_revoked"
    | "reconnect_required";

  constructor(
    code:
      | "invalid_configuration"
      | "invalid_state"
      | "expired_state"
      | "state_binding_mismatch"
      | "invalid_token_response"
      | "scope_mismatch"
      | "provider_revoked"
      | "reconnect_required",
    message: string,
  ) {
    super(message);
    this.name = "GoogleWorkspaceOAuthContractError";
    this.code = code;
  }
}

export function googleWorkspaceEncryptionKey(value: string) {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new GoogleWorkspaceOAuthContractError(
      "invalid_configuration",
      "GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY muss als Base64-Wert exakt 32 Byte ergeben.",
    );
  }
  return decoded;
}

export function encryptGoogleWorkspaceToken(token: string, key: Buffer) {
  if (!token) throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Google OAuth Token fehlt.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, ciphertext]
    .map((part) => Buffer.isBuffer(part) ? part.toString("base64url") : part)
    .join(".");
}

export function decryptGoogleWorkspaceToken(value: string, key: Buffer) {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new GoogleWorkspaceOAuthContractError("reconnect_required", "Gespeicherter Google OAuth Token ist ungültig.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new GoogleWorkspaceOAuthContractError("reconnect_required", "Gespeicherter Google OAuth Token konnte nicht entschlüsselt werden.");
  }
}

function safeRelativeNext(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/team";
  try {
    const parsed = new URL(value, "http://localhost");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/team";
  }
}

function encodedState(payload: GoogleWorkspaceOAuthState) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function stateSignature(encoded: string, key: Buffer) {
  const signingKey = Buffer.from(hkdfSync(
    "sha256",
    key,
    Buffer.from("founderops-google-workspace-state:v1", "utf8"),
    Buffer.from("oauth-state-signing", "utf8"),
    32,
  ));
  // codeql[js/insufficient-password-hash] OAuth state uses HMAC with a random 32-byte key; no password is hashed here.
  return createHmac("sha256", signingKey).update(encoded).digest("base64url");
}

export function createGoogleWorkspaceOAuthState({
  userId,
  profileId,
  next = "/team",
  now = Date.now(),
  nonce = randomBytes(16).toString("base64url"),
  key,
}: {
  userId: string;
  profileId: string;
  next?: string;
  now?: number;
  nonce?: string;
  key: Buffer;
}) {
  const payload: GoogleWorkspaceOAuthState = {
    userId,
    profileId,
    next: safeRelativeNext(next),
    exp: now + GOOGLE_WORKSPACE_STATE_TTL_MS,
    nonce,
  };
  const encoded = encodedState(payload);
  return `${encoded}.${stateSignature(encoded, key)}`;
}

export function verifyGoogleWorkspaceOAuthState(value: string, { key, now = Date.now() }: { key: Buffer; now?: number }) {
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) {
    throw new GoogleWorkspaceOAuthContractError("invalid_state", "Google OAuth State ist ungültig.");
  }
  const expected = Buffer.from(stateSignature(encoded, key));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new GoogleWorkspaceOAuthContractError("invalid_state", "Google OAuth State konnte nicht geprüft werden.");
  }
  let payload: GoogleWorkspaceOAuthState;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GoogleWorkspaceOAuthState;
  } catch {
    throw new GoogleWorkspaceOAuthContractError("invalid_state", "Google OAuth State ist ungültig.");
  }
  if (!payload.userId || !payload.profileId || !payload.nonce || !payload.exp || payload.exp < now) {
    throw new GoogleWorkspaceOAuthContractError("expired_state", "Google OAuth State ist abgelaufen.");
  }
  return { ...payload, next: safeRelativeNext(payload.next) };
}

export function assertGoogleWorkspaceOAuthStateBinding(
  state: GoogleWorkspaceOAuthState,
  current: { userId: string; profileId: string },
) {
  if (state.userId !== current.userId || state.profileId !== current.profileId) {
    throw new GoogleWorkspaceOAuthContractError(
      "state_binding_mismatch",
      "Google OAuth State passt nicht zur aktuellen FounderOps-Sitzung.",
    );
  }
}

export function googleWorkspaceAuthorizationUrl({
  clientId,
  redirectUri,
  state,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("scope", GOOGLE_WORKSPACE_CALENDAR_SCOPE);
  url.searchParams.set("state", state);
  return url;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizedScopes(value: unknown) {
  return typeof value === "string" ? value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean).sort() : [];
}

export function validateGoogleWorkspaceTokenResponse(
  value: unknown,
  { requireRefreshToken = true, allowMissingScope = false }: { requireRefreshToken?: boolean; allowMissingScope?: boolean } = {},
) {
  const token = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const accessToken = typeof token.access_token === "string" ? token.access_token : "";
  const refreshToken = typeof token.refresh_token === "string" ? token.refresh_token : null;
  const expiresIn = positiveInteger(token.expires_in);
  const scopes = normalizedScopes(token.scope);
  const tokenType = typeof token.token_type === "string" ? token.token_type : "";
  if (!accessToken || !expiresIn || tokenType.toLowerCase() !== "bearer" || (requireRefreshToken && !refreshToken)) {
    throw new GoogleWorkspaceOAuthContractError("invalid_token_response", "Google OAuth Token-Antwort ist unvollständig.");
  }
  if ((!allowMissingScope || scopes.length) && (
    scopes.length !== 1 || scopes[0] !== GOOGLE_WORKSPACE_CALENDAR_SCOPE
  )) {
    throw new GoogleWorkspaceOAuthContractError("scope_mismatch", "Google OAuth Scope stimmt nicht mit dem FounderOps-Vertrag überein.");
  }
  return {
    accessToken,
    refreshToken,
    expiresIn,
    refreshTokenExpiresIn: positiveInteger(token.refresh_token_expires_in),
    scope: scopes.length ? scopes : [GOOGLE_WORKSPACE_CALENDAR_SCOPE],
    tokenType: "Bearer",
  } satisfies GoogleWorkspaceTokenResponse;
}

export function googleWorkspaceConnectionStatus(row: GoogleWorkspaceConnectionRow | null, now = Date.now()): GoogleWorkspaceConnectionStatus {
  if (!row) {
    return { state: "not_connected", connectedAt: null, refreshedAt: null, lastUsedAt: null, accessTokenExpiresAt: null };
  }
  const refreshExpired = Boolean(row.refresh_token_expires_at && new Date(row.refresh_token_expires_at).getTime() <= now);
  const reconnectRequired = Boolean(
    row.revoked_at
    || refreshExpired
    || row.last_error_class === "oauth_reconnect_required"
    || row.last_error_class === "oauth_scope_mismatch",
  );
  return {
    state: reconnectRequired ? "reconnect_required" : "connected",
    connectedAt: row.connected_at,
    refreshedAt: row.refreshed_at,
    lastUsedAt: row.last_used_at,
    accessTokenExpiresAt: row.access_token_expires_at,
  };
}
