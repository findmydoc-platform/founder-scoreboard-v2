import { authorizeCredentialAction } from "./credentials";
import type { NotificationEvent, Profile } from "./types";

export type GoogleChatDeliveryEvent = Pick<NotificationEvent, "id" | "type" | "title" | "body" | "entityType" | "entityId" | "createdAt"> & {
  actorName?: string;
  recipientName?: string;
};

export type GoogleChatDigestEvent = GoogleChatDeliveryEvent & {
  targetLabel?: string;
};

export async function googleChatDeliveryStatus() {
  return authorizeCredentialAction({ credential: { kind: "google-chat-configuration" }, action: "google-chat.status" });
}

export async function hasGoogleChatWebhook() { return (await googleChatDeliveryStatus()).webhookConfigured; }
export async function hasGoogleChatApiCredentials() { return (await googleChatDeliveryStatus()).apiConfigured; }
export async function isGoogleChatDeliveryEnabled() { return (await googleChatDeliveryStatus()).deliveryEnabled; }

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
  if (type === "meeting.attendance_updated") return "Weekly";
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

export async function sendGoogleChatSpaceDigest(spaceName: string, events: GoogleChatDigestEvent[], appUrl: string) {
  const authorized = await authorizeCredentialAction({ credential: { kind: "google-chat-bot" }, action: "google-chat.space.deliver", target: spaceName });
  await authorized.chat.send(formatGoogleChatDigestCard(events, appUrl));
}

export async function sendGoogleChatWebhook(event: GoogleChatDeliveryEvent) {
  const authorized = await authorizeCredentialAction({ credential: { kind: "google-chat-webhook" }, action: "google-chat.webhook.deliver" });
  await authorized.chat.send({ text: formatGoogleChatMessage(event) });
}

export async function sendGoogleChatDigest(events: GoogleChatDigestEvent[], appUrl: string) {
  const authorized = await authorizeCredentialAction({ credential: { kind: "google-chat-webhook" }, action: "google-chat.webhook.deliver" });
  await authorized.chat.send(formatGoogleChatDigestCard(events, appUrl));
}
