import { reassertDeliveryAdmission } from "./delivery-admission-scope";
import "server-only";
import { createHash, createSign } from "node:crypto";
import type { GoogleChatDeliveryInput, GoogleChatDeliveryResult, GoogleChatDeliveryStatus } from "../google-chat-types";

const tokenEndpoint = "https://oauth2.googleapis.com/token";
const scope = "https://www.googleapis.com/auth/chat.bot";
type BotConfiguration = Readonly<{ email: string; privateKey: string; fingerprint: string }>;
type AccessToken = Readonly<{ value: string; expiresAt: number }>;
const tokens = new Map<string, AccessToken>();
const issuing = new Map<string, Promise<AccessToken>>();
const maximumCachedTokens = 16;

function failure(name: string, message: string): never {
  const error = new Error(message);
  error.name = name;
  throw error;
}

export function googleChatStatus(): GoogleChatDeliveryStatus {
  const webhookConfigured = Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL);
  const apiConfigured = Boolean(process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_CHAT_PRIVATE_KEY);
  const deliveryEnabled = process.env.GOOGLE_CHAT_DELIVERY_ENABLED === "true";
  return { webhookConfigured, apiConfigured, deliveryEnabled, ready: (webhookConfigured || apiConfigured) && deliveryEnabled,
    mode: apiConfigured ? "direct-dm" : webhookConfigured ? "space-webhook" : "not-configured" };
}

function requireEnabled() {
  if (!googleChatStatus().deliveryEnabled) failure("GoogleChatDeliveryDisabled", "GOOGLE_CHAT_DELIVERY_ENABLED ist nicht auf true gesetzt.");
}

function botConfiguration(): BotConfiguration {
  requireEnabled();
  const email = process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_CHAT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!email || !privateKey) failure("GoogleChatApiNotConfigured", "GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL oder GOOGLE_CHAT_PRIVATE_KEY ist nicht gesetzt.");
  return { email, privateKey, fingerprint: createHash("sha256").update(JSON.stringify([email, privateKey, tokenEndpoint, scope])).digest("hex") };
}

function requireCurrentBot(configuration: BotConfiguration) {
  if (botConfiguration().fingerprint !== configuration.fingerprint) failure("GoogleChatConfigurationChanged", "Google Chat Konfiguration wurde während der Zustellung geändert.");
}

function webhookConfiguration(): string {
  requireEnabled();
  const value = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!value) failure("GoogleChatNotConfigured", "GOOGLE_CHAT_WEBHOOK_URL ist nicht gesetzt.");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "chat.googleapis.com" || url.port || url.username || url.password || url.hash
      || !/^\/v1\/spaces\/[A-Za-z0-9_-]+\/messages$/.test(url.pathname)) throw new Error("Invalid configured target");
  } catch { failure("GoogleChatNotConfigured", "GOOGLE_CHAT_WEBHOOK_URL ist ungültig."); }
  return value;
}

function requireCurrentWebhook(target: string) {
  if (webhookConfiguration() !== target) failure("GoogleChatConfigurationChanged", "Google Chat Konfiguration wurde während der Zustellung geändert.");
}

async function issueToken(configuration: BotConfiguration): Promise<AccessToken> {
  const startedAt = Date.now();
  const now = Math.floor(startedAt / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: configuration.email, scope, aud: tokenEndpoint, exp: now + 3600, iat: now })}`;
  let assertion: string;
  try { assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(configuration.privateKey).toString("base64url")}`; }
  catch { return failure("GoogleChatCredentialInvalid", "Google Chat Service-Account konnte nicht geprüft werden."); }
  let response: Response;
  try {
    response = await fetch(tokenEndpoint, { method: "POST", redirect: "error", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  } catch { return failure("GoogleChatCredentialUnavailable", "Google Chat Token konnte nicht erstellt werden."); }
  if (!response.ok) failure("GoogleChatCredentialUnavailable", `Google Chat Token konnte nicht erstellt werden: ${response.status}`);
  let token: { access_token?: unknown; expires_in?: unknown; token_type?: unknown; scope?: unknown };
  try { token = await response.json(); } catch { return failure("GoogleChatCredentialInvalid", "Google Chat Token-Antwort ist ungültig."); }
  if (!token || typeof token !== "object" || Array.isArray(token)) failure("GoogleChatCredentialInvalid", "Google Chat Token-Antwort ist ungültig.");
  const lifetime = token.expires_in === undefined ? 3600 : token.expires_in;
  if (typeof token.access_token !== "string" || !token.access_token || typeof lifetime !== "number" || !Number.isFinite(lifetime) || lifetime <= 0
    || (token.token_type !== undefined && token.token_type !== "Bearer")
    || (token.scope !== undefined && (typeof token.scope !== "string" || !token.scope.split(" ").includes(scope)))) {
    failure("GoogleChatCredentialInvalid", "Google Chat Token-Antwort ist ungültig.");
  }
  // Provider latency must not create a new validity period after issuance completes.
  const result = { value: token.access_token, expiresAt: Math.min(startedAt + lifetime * 1000, (now + 3600) * 1000) };
  requireCurrentBot(configuration);
  if (Date.now() >= result.expiresAt) failure("GoogleChatCredentialExpired", "Google Chat Token ist abgelaufen.");
  for (const [key, cached] of tokens) if (cached.expiresAt <= Date.now()) tokens.delete(key);
  if (tokens.size >= maximumCachedTokens) tokens.delete(tokens.keys().next().value!);
  tokens.set(configuration.fingerprint, result);
  return result;
}

async function accessToken(configuration: BotConfiguration): Promise<AccessToken> {
  requireCurrentBot(configuration);
  const cached = tokens.get(configuration.fingerprint);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
  const pending = issuing.get(configuration.fingerprint);
  if (pending) return pending;
  const request = issueToken(configuration);
  issuing.set(configuration.fingerprint, request);
  try { return await request; }
  finally { if (issuing.get(configuration.fingerprint) === request) issuing.delete(configuration.fingerprint); }
}

async function dispatch(target: string, body: string, access?: { credential: AccessToken; fingerprint: string }) {
  let response: Response;
  try {
    // A failed or lost response may follow a successful mutation. Never refresh and replay here.
    response = await fetch(target, { method: "POST", redirect: "error", headers: { "content-type": "application/json; charset=UTF-8",
      ...(access ? { authorization: `Bearer ${access.credential.value}` } : {}) }, body });
  } catch { return failure("GoogleChatDeliveryUnknown", access ? "Google Chat DM-Versand konnte nicht bestätigt werden." : "Google Chat Versand konnte nicht bestätigt werden."); }
  // Rejection invalidates only this exact entry. A late response cannot discard a newer token.
  if (response.status === 401 && access && tokens.get(access.fingerprint) === access.credential) tokens.delete(access.fingerprint);
  if (!response.ok) failure("GoogleChatDeliveryFailed", `${access ? "Google Chat DM-Versand" : "Google Chat Versand"} fehlgeschlagen: ${response.status}`);
}

export async function authorizeGoogleChat(input: GoogleChatDeliveryInput): Promise<GoogleChatDeliveryResult> {
  if (input.action === "google-chat.space.deliver" && input.credential.kind === "google-chat-bot") {
    const configuration = botConfiguration();
    const target = input.target.trim();
    if (!/^spaces\/[A-Za-z0-9_-]+$/.test(target)) failure("GoogleChatTargetInvalid", "Google Chat DM-Space muss im Format spaces/... gespeichert sein.");
    return { ok: true, chat: { send: async message => {
      const body = JSON.stringify(message);
      const token = await accessToken(configuration);
      const assertAdmission = await reassertDeliveryAdmission();
      requireCurrentBot(configuration);
      if (Date.now() >= token.expiresAt) failure("GoogleChatCredentialExpired", "Google Chat Token ist abgelaufen.");
      assertAdmission();
      await dispatch(`https://chat.googleapis.com/v1/${target}/messages`, body, { credential: token, fingerprint: configuration.fingerprint });
    } } };
  }
  if (input.action === "google-chat.webhook.deliver" && input.credential.kind === "google-chat-webhook") {
    const target = webhookConfiguration();
    return { ok: true, chat: { send: async message => {
      const body = JSON.stringify(message);
      const assertAdmission = await reassertDeliveryAdmission();
      requireCurrentWebhook(target);
      assertAdmission();
      await dispatch(target, body);
    } } };
  }
  return failure("GoogleChatCredentialDenied", "Keine Berechtigung für diese Google-Chat-Aktion.");
}
