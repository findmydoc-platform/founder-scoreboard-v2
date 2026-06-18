import type { NotificationEvent, Profile } from "./types";

export type GoogleChatDeliveryEvent = Pick<NotificationEvent, "id" | "type" | "title" | "body" | "entityType" | "entityId" | "createdAt"> & {
  actorName?: string;
  recipientName?: string;
};

export type GoogleChatDigestEvent = GoogleChatDeliveryEvent & {
  targetLabel?: string;
};

export function hasGoogleChatWebhook() {
  return Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL);
}

export function hasGoogleChatApiCredentials() {
  return Boolean(process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_CHAT_PRIVATE_KEY);
}

export function isGoogleChatDeliveryEnabled() {
  return process.env.GOOGLE_CHAT_DELIVERY_ENABLED === "true";
}

export function googleChatDeliveryStatus() {
  const webhookConfigured = hasGoogleChatWebhook();
  const apiConfigured = hasGoogleChatApiCredentials();
  const deliveryEnabled = isGoogleChatDeliveryEnabled();
  return {
    webhookConfigured,
    apiConfigured,
    deliveryEnabled,
    ready: (webhookConfigured || apiConfigured) && deliveryEnabled,
    mode: apiConfigured ? "direct-dm" : webhookConfigured ? "space-webhook" : "not-configured",
  };
}

export function googleChatTarget(profile?: Pick<Profile, "googleChatDmSpace" | "googleChatUserId"> | null) {
  return profile?.googleChatDmSpace || profile?.googleChatUserId || "founder-scoreboard-space";
}

export function isGoogleChatDmSpace(target: string) {
  return /^spaces\/[A-Za-z0-9_-]+$/.test(target.trim());
}

export function formatGoogleChatMessage(event: GoogleChatDeliveryEvent) {
  return [
    `*${event.title}*`,
    event.body || "",
    event.actorName ? `Von: ${event.actorName}` : "",
    event.recipientName ? `Für: ${event.recipientName}` : "",
    `Typ: ${event.type}`,
    `${event.entityType}: ${event.entityId}`,
  ].filter(Boolean).join("\n");
}

function eventUrl(event: Pick<GoogleChatDeliveryEvent, "entityType" | "entityId">, appUrl: string) {
  const baseUrl = appUrl.replace(/\/$/, "");
  if (event.entityType === "task" && event.entityId) return `${baseUrl}/tasks/${encodeURIComponent(event.entityId)}`;
  return baseUrl;
}

function digestTypeLabel(type: string) {
  if (type === "task.blocker_reported") return "Blocker";
  if (type === "task.mention") return "Erwähnung";
  if (type === "task.review_requested") return "Review";
  if (type === "task.proposed") return "Vorschlag";
  if (type === "sprint.task_carried_over") return "Carry-over";
  if (type.startsWith("decision.")) return "Decision";
  return "Hinweis";
}

function digestIntro(events: GoogleChatDigestEvent[]) {
  const blockerCount = events.filter((event) => event.type === "task.blocker_reported").length;
  const reviewCount = events.filter((event) => event.type === "task.review_requested").length;
  const proposalCount = events.filter((event) => event.type === "task.proposed").length;
  const parts = [
    blockerCount ? `${blockerCount} Blocker` : "",
    reviewCount ? `${reviewCount} Reviews` : "",
    proposalCount ? `${proposalCount} Vorschläge` : "",
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : `${events.length} wichtige Hinweise`;
}

export function formatGoogleChatDigestCard(events: GoogleChatDigestEvent[], appUrl: string) {
  const lines = events.slice(0, 8).map((event) => {
    const target = event.recipientName ? ` für ${event.recipientName}` : "";
    const actor = event.actorName ? ` · von ${event.actorName}` : "";
    return `<b>${digestTypeLabel(event.type)}:</b> ${event.title}${target}${actor}`;
  }).join("\n");
  const overflow = events.length > 8 ? `\n\n+ ${events.length - 8} weitere Hinweise in FounderOps` : "";

  return {
    cardsV2: [{
      cardId: `fmd-planning-digest-${Date.now()}`,
      card: {
        header: {
          title: "FounderOps: Fokus-Digest",
          subtitle: digestIntro(events),
          imageUrl: "https://github.com/findmydoc-platform.png",
          imageType: "CIRCLE",
        },
        sections: [
          {
            header: "Wichtig",
            widgets: [{
              textParagraph: {
                text: `${lines}${overflow}`,
              },
            }],
          },
          {
            widgets: [{
              buttonList: {
                buttons: [{
                  text: events.length === 1 && events[0]?.entityType === "task" ? "Aufgabe öffnen" : "FounderOps öffnen",
                  onClick: { openLink: { url: events.length === 1 && events[0] ? eventUrl(events[0], appUrl) : appUrl } },
                }],
              },
            }],
          },
        ],
      },
    }],
  };
}

function assertGoogleChatReady() {
  const status = googleChatDeliveryStatus();
  if (!status.deliveryEnabled) {
    const error = new Error("GOOGLE_CHAT_DELIVERY_ENABLED ist nicht auf true gesetzt.");
    error.name = "GoogleChatDeliveryDisabled";
    throw error;
  }

  const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    const error = new Error("GOOGLE_CHAT_WEBHOOK_URL ist nicht gesetzt.");
    error.name = "GoogleChatNotConfigured";
    throw error;
  }

  return webhookUrl;
}

function assertGoogleChatApiReady() {
  const status = googleChatDeliveryStatus();
  if (!status.deliveryEnabled) {
    const error = new Error("GOOGLE_CHAT_DELIVERY_ENABLED ist nicht auf true gesetzt.");
    error.name = "GoogleChatDeliveryDisabled";
    throw error;
  }

  const clientEmail = process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_CHAT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!clientEmail || !privateKey) {
    const error = new Error("GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL oder GOOGLE_CHAT_PRIVATE_KEY ist nicht gesetzt.");
    error.name = "GoogleChatApiNotConfigured";
    throw error;
  }

  return { clientEmail, privateKey };
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getGoogleChatAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const { clientEmail, privateKey } = assertGoogleChatApiReady();
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/chat.bot",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const unsignedToken = `${header}.${claim}`;
  const { createSign } = await import("node:crypto");
  const signature = createSign("RSA-SHA256").update(unsignedToken).sign(privateKey);
  const assertion = `${unsignedToken}.${base64Url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Google Chat Token konnte nicht erstellt werden: ${response.status}${details ? ` ${details.slice(0, 240)}` : ""}`);
  }

  const token = await response.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error("Google Chat Token-Antwort enthält kein access_token.");

  cachedAccessToken = {
    token: token.access_token,
    expiresAt: Date.now() + Math.max(60, token.expires_in || 3600) * 1000,
  };
  return cachedAccessToken.token;
}

export async function sendGoogleChatSpaceDigest(spaceName: string, events: GoogleChatDigestEvent[], appUrl: string) {
  assertGoogleChatApiReady();
  if (!isGoogleChatDmSpace(spaceName)) {
    throw new Error("Google Chat DM-Space muss im Format spaces/... gespeichert sein.");
  }

  const accessToken = await getGoogleChatAccessToken();
  const response = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(formatGoogleChatDigestCard(events, appUrl)),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Google Chat DM-Versand fehlgeschlagen: ${response.status}${details ? ` ${details.slice(0, 240)}` : ""}`);
  }
}

export async function sendGoogleChatWebhook(event: GoogleChatDeliveryEvent) {
  const webhookUrl = assertGoogleChatReady();

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: formatGoogleChatMessage(event) }),
  });

  if (!response.ok) {
    throw new Error(`Google Chat Versand fehlgeschlagen: ${response.status}`);
  }
}

export async function sendGoogleChatDigest(events: GoogleChatDigestEvent[], appUrl: string) {
  const webhookUrl = assertGoogleChatReady();

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(formatGoogleChatDigestCard(events, appUrl)),
  });

  if (!response.ok) {
    throw new Error(`Google Chat Versand fehlgeschlagen: ${response.status}`);
  }
}
