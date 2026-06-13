import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const separator = trimmed.indexOf("=");
  if (separator < 0) return null;

  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  return [key, value];
}

if (existsSync(envPath)) {
  const envFile = await readFile(envPath, "utf8");
  for (const pair of envFile.split(/\r?\n/).map(parseEnvLine)) {
    if (!pair) continue;
    const [key, value] = pair;
    process.env[key] ||= value;
  }
}

const envExample = await readFile(".env.example", "utf8");
const rollout = await readFile("docs/google-chat-rollout.md", "utf8");
const nextStep = await readFile("docs/google-chat-next-step.md", "utf8");
const settingsUi = await readFile("src/components/settings-notifications.tsx", "utf8");
const deliverRoute = await readFile("src/app/api/notifications/deliver/route.ts", "utf8");
const eventRoute = await readFile("src/app/api/google-chat/events/route.ts", "utf8");
const googleChat = await readFile("src/lib/google-chat.ts", "utf8");
const digestWorkflow = await readFile(".github/workflows/google-chat-digest.yml", "utf8");

function googleChatDeliveryStatus() {
  const webhookConfigured = Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL);
  const apiConfigured = Boolean(process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_CHAT_PRIVATE_KEY);
  const deliveryEnabled = process.env.GOOGLE_CHAT_DELIVERY_ENABLED === "true";
  return {
    webhookConfigured,
    apiConfigured,
    deliveryEnabled,
    ready: (webhookConfigured || apiConfigured) && deliveryEnabled,
  };
}

const requiredChecks = [
  ["env example contains webhook", envExample.includes("GOOGLE_CHAT_WEBHOOK_URL=")],
  ["env example contains chat api service account", envExample.includes("GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL=")],
  ["env example contains chat api private key", envExample.includes("GOOGLE_CHAT_PRIVATE_KEY=")],
  ["env example contains delivery gate", envExample.includes("GOOGLE_CHAT_DELIVERY_ENABLED=false")],
  ["env example contains pipeline secret", envExample.includes("FOUNDEROPS_DELIVERY_SECRET=")],
  ["env example documents phase 1 app url", envExample.includes("APP_URL=https://founder-ops.findmydoc.eu")],
  ["env example documents pipeline header", envExample.includes("x-founderops-delivery-secret")],
  ["rollout documents disabled state", rollout.includes("GOOGLE_CHAT_DELIVERY_ENABLED=false")],
  ["rollout documents enabled state", rollout.includes("GOOGLE_CHAT_DELIVERY_ENABLED=true")],
  ["rollout documents phase 1 group digest", rollout.includes("Phase 1: FounderOps-Gruppendigest")],
  ["rollout documents phase 2 external pipeline", rollout.includes("Phase 2: Externe Pipeline")],
  ["rollout documents weekday schedule", rollout.includes("09:00 Europe/Berlin")],
  ["rollout documents delivery secret", rollout.includes("FOUNDEROPS_DELIVERY_SECRET")],
  ["rollout documents rresta handoff package", rollout.includes("Sebastian-/Rresta-Übergabepaket")],
  ["rollout documents phase 1 production app url", rollout.includes("APP_URL=https://founder-ops.findmydoc.eu")],
  ["rollout documents preferences", rollout.includes("notification_preferences")],
  ["rollout documents rollback", rollout.includes("Rollback")],
  ["rollout documents phase 4 direct dms", rollout.includes("Phase 4: Persönliche FounderOps-DMs")],
  ["rollout documents direct dm no fallback", rollout.includes("keinen Gruppenchat-Fallback")],
  ["rollout documents production chat endpoint", rollout.includes("https://founder-ops.findmydoc.eu/api/google-chat/events")],
  ["rollout separates operational events", rollout.includes("Operative Event Messages bleiben in der Applikation")],
  ["rollout limits pipeline to release details", rollout.includes("Release-Details oder Deployment-Zusammenfassungen")],
  ["digest card uses FounderOps button", googleChat.includes("FounderOps öffnen")],
  ["digest card avoids old Scoreboard button", !googleChat.includes("Scoreboard öffnen")],
  ["next-step links rollout", nextStep.includes("docs/google-chat-rollout.md")],
  ["next-step documents no dm fallback", nextStep.includes("keinen Gruppenchat-Fallback")],
  ["next-step separates release pipeline", nextStep.includes("Release-Kanal")],
  ["next-step keeps operational events in app", nextStep.includes("Operative Event Messages bleiben in der Applikation")],
  ["settings UI explains readiness", settingsUi.includes("googleChatReady")],
  ["settings UI keeps operational events in app", settingsUi.includes("Operative Event Messages bleiben in der App")],
  ["delivery route is gated", deliverRoute.includes("googleChatDeliveryStatus")],
  ["delivery route supports pipeline secret header", deliverRoute.includes("x-founderops-delivery-secret") && deliverRoute.includes("FOUNDEROPS_DELIVERY_SECRET")],
  ["github digest workflow exists", digestWorkflow.includes("name: Google Chat Digest")],
  ["github digest workflow uses weekday schedule", digestWorkflow.includes("cron: \"0 7 * * 1-5\"")],
  ["github digest workflow uses secret header", digestWorkflow.includes("x-founderops-delivery-secret") && digestWorkflow.includes("FOUNDEROPS_DELIVERY_SECRET")],
  ["delivery route supports direct dm spaces", deliverRoute.includes("sendGoogleChatSpaceDigest") && deliverRoute.includes("isGoogleChatDmSpace")],
  ["chat event route exists", eventRoute.includes("FounderOps Google Chat Events")],
  ["chat event route stays gated", eventRoute.includes("googleChatDeliveryStatus")],
  ["chat event route handles message events", eventRoute.includes("MESSAGE")],
];

const failed = requiredChecks.filter(([, passed]) => !passed);

const status = googleChatDeliveryStatus();
const result = {
  googleChatConfigured: status.webhookConfigured,
  googleChatApiConfigured: status.apiConfigured,
  googleChatDeliveryEnabled: status.deliveryEnabled,
  googleChatReady: status.ready,
  checks: Object.fromEntries(requiredChecks),
};

console.log(JSON.stringify(result, null, 2));

if (failed.length > 0) {
  console.error(`Google Chat rollout check failed: ${failed.map(([label]) => label).join(", ")}`);
  process.exit(1);
}
