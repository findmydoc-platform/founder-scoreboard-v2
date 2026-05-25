import type { NotificationEvent, Profile } from "./types";

export type GoogleChatDeliveryEvent = Pick<NotificationEvent, "id" | "type" | "title" | "body" | "entityType" | "entityId" | "createdAt"> & {
  actorName?: string;
  recipientName?: string;
};

export function hasGoogleChatWebhook() {
  return Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL);
}

export function googleChatTarget(profile?: Pick<Profile, "googleChatDmSpace" | "googleChatUserId"> | null) {
  return profile?.googleChatDmSpace || profile?.googleChatUserId || "founder-scoreboard-space";
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

export async function sendGoogleChatWebhook(event: GoogleChatDeliveryEvent) {
  const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    const error = new Error("GOOGLE_CHAT_WEBHOOK_URL ist nicht gesetzt.");
    error.name = "GoogleChatNotConfigured";
    throw error;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: formatGoogleChatMessage(event) }),
  });

  if (!response.ok) {
    throw new Error(`Google Chat Versand fehlgeschlagen: ${response.status}`);
  }
}
