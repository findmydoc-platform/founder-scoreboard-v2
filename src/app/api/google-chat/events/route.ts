import { NextResponse, type NextRequest } from "next/server";
import { googleChatDeliveryStatus } from "@/lib/google-chat";

type GoogleChatEventPayload = {
  type?: string;
  message?: {
    text?: string;
    sender?: {
      name?: string;
      displayName?: string;
    };
  };
  space?: {
    name?: string;
    type?: string;
  };
};

const endpoint = "FounderOps Google Chat Events";

function safeString(value: unknown, fallback = "unknown") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function routeStatus() {
  const status = googleChatDeliveryStatus();
  return {
    endpoint,
    ready: status.ready,
    webhookConfigured: status.webhookConfigured,
    deliveryEnabled: status.deliveryEnabled,
    mode: status.ready ? "delivery-ready" : "safe-preview",
  };
}

export async function GET() {
  const status = routeStatus();

  return NextResponse.json({
    ok: true,
    ...status,
    message: status.ready
      ? "FounderOps ist erreichbar und die Google-Chat-Zustellung ist aktiviert."
      : "FounderOps ist erreichbar. Die Google-Chat-Zustellung bleibt bis zum kontrollierten Rollout deaktiviert.",
  });
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null) as GoogleChatEventPayload | null;

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Ungültiges Google-Chat-Event." }, { status: 400 });
  }

  const status = routeStatus();
  const eventType = safeString(payload.type);

  if (eventType === "MESSAGE") {
    return NextResponse.json({
      text: status.ready
        ? "FounderOps hat deine Nachricht erhalten. Direkte Chat-Kommandos werden schrittweise aktiviert."
        : "FounderOps ist erreichbar. Die persönliche Google-Chat-Zustellung bleibt bis zum finalen Rollout deaktiviert.",
    });
  }

  return NextResponse.json({
    ok: true,
    ...status,
    eventType,
    space: safeString(payload.space?.name, ""),
    sender: safeString(payload.message?.sender?.displayName, ""),
    handled: false,
    message: "Event empfangen; aktive Google-Chat-Automationen bleiben bis zum Rollout deaktiviert.",
  });
}
