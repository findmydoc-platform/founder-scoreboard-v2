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

export function googleChatTarget(profile?: Pick<Profile, "googleChatDmSpace" | "googleChatUserId"> | null) {
  return profile?.googleChatDmSpace || profile?.googleChatUserId || "founder-scoreboard-space";
}

export function shouldSendToGoogleChatDigest(eventType: string) {
  return [
    "task.blocker_reported",
    "task.proposed",
    "task.review_requested",
    "sprint.task_carried_over",
    "decision.confirmation_requested",
  ].includes(eventType);
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

function digestTypeLabel(type: string) {
  if (type === "task.blocker_reported") return "Blocker";
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
  const overflow = events.length > 8 ? `\n\n+ ${events.length - 8} weitere Hinweise im Scoreboard` : "";

  return {
    cardsV2: [{
      cardId: `fmd-planning-digest-${Date.now()}`,
      card: {
        header: {
          title: "Founder Scoreboard: Fokus-Digest",
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
                  text: "Scoreboard öffnen",
                  onClick: { openLink: { url: appUrl } },
                }],
              },
            }],
          },
        ],
      },
    }],
  };
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

export async function sendGoogleChatDigest(events: GoogleChatDigestEvent[], appUrl: string) {
  const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    const error = new Error("GOOGLE_CHAT_WEBHOOK_URL ist nicht gesetzt.");
    error.name = "GoogleChatNotConfigured";
    throw error;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(formatGoogleChatDigestCard(events, appUrl)),
  });

  if (!response.ok) {
    throw new Error(`Google Chat Versand fehlgeschlagen: ${response.status}`);
  }
}
