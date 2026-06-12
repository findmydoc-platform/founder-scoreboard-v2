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
const settingsUi = await readFile("src/components/planning-app.tsx", "utf8");
const deliverRoute = await readFile("src/app/api/notifications/deliver/route.ts", "utf8");
const eventRoute = await readFile("src/app/api/google-chat/events/route.ts", "utf8");

function googleChatDeliveryStatus() {
  const webhookConfigured = Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL);
  const deliveryEnabled = process.env.GOOGLE_CHAT_DELIVERY_ENABLED === "true";
  return {
    webhookConfigured,
    deliveryEnabled,
    ready: webhookConfigured && deliveryEnabled,
  };
}

const requiredChecks = [
  ["env example contains webhook", envExample.includes("GOOGLE_CHAT_WEBHOOK_URL=")],
  ["env example contains delivery gate", envExample.includes("GOOGLE_CHAT_DELIVERY_ENABLED=false")],
  ["rollout documents disabled state", rollout.includes("GOOGLE_CHAT_DELIVERY_ENABLED=false")],
  ["rollout documents enabled state", rollout.includes("GOOGLE_CHAT_DELIVERY_ENABLED=true")],
  ["rollout documents preferences", rollout.includes("notification_preferences")],
  ["rollout documents rollback", rollout.includes("Rollback")],
  ["rollout separates operational events", rollout.includes("Operative Event Messages bleiben in der Applikation")],
  ["rollout limits pipeline to release details", rollout.includes("Release-Details oder Deployment-Zusammenfassungen")],
  ["next-step links rollout", nextStep.includes("docs/google-chat-rollout.md")],
  ["next-step separates release pipeline", nextStep.includes("Release-Kanal")],
  ["next-step keeps operational events in app", nextStep.includes("Operative Event Messages bleiben in der Applikation")],
  ["settings UI explains readiness", settingsUi.includes("googleChatReady")],
  ["settings UI keeps operational events in app", settingsUi.includes("Operative Event Messages bleiben in der App")],
  ["delivery route is gated", deliverRoute.includes("googleChatDeliveryStatus")],
  ["chat event route exists", eventRoute.includes("FounderOps Google Chat Events")],
  ["chat event route stays gated", eventRoute.includes("googleChatDeliveryStatus")],
  ["chat event route handles message events", eventRoute.includes("MESSAGE")],
];

const failed = requiredChecks.filter(([, passed]) => !passed);

const status = googleChatDeliveryStatus();
const result = {
  googleChatConfigured: status.webhookConfigured,
  googleChatDeliveryEnabled: status.deliveryEnabled,
  googleChatReady: status.ready,
  checks: Object.fromEntries(requiredChecks),
};

console.log(JSON.stringify(result, null, 2));

if (failed.length > 0) {
  console.error(`Google Chat rollout check failed: ${failed.map(([label]) => label).join(", ")}`);
  process.exit(1);
}
