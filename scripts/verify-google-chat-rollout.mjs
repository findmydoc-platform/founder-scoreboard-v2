import { readFile } from "node:fs/promises";
import { loadLocalEnv } from "./lib/env.mjs";

await loadLocalEnv();

const envExample = await readFile(".env.example", "utf8");
const rollout = await readFile("docs/google-chat-rollout.md", "utf8");
const deliverRoute = await readFile("src/app/api/notifications/deliver/route.ts", "utf8");
const eventRoute = await readFile("src/app/api/google-chat/events/route.ts", "utf8");
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
  ["rollout documents weekday schedule", rollout.includes("09:00 Europe/Berlin")],
  ["rollout documents delivery secret", rollout.includes("FOUNDEROPS_DELIVERY_SECRET")],
  ["rollout documents phase 1 production app url", rollout.includes("APP_URL=https://founder-ops.findmydoc.eu")],
  ["rollout documents pipeline header", rollout.includes("x-founderops-delivery-secret")],
  ["rollout documents rollback", rollout.includes("Rollback")],
  ["rollout documents direct dm no fallback", rollout.includes("keinen Gruppenchat-Fallback")],
  ["rollout documents production chat endpoint", rollout.includes("https://founder-ops.findmydoc.eu/api/google-chat/events")],
  ["delivery route is gated", deliverRoute.includes("googleChatDeliveryStatus")],
  ["delivery route supports pipeline secret header", deliverRoute.includes("x-founderops-delivery-secret") && deliverRoute.includes("FOUNDEROPS_DELIVERY_SECRET")],
  ["delivery route supports event id retry", deliverRoute.includes("eventIds") && deliverRoute.includes("maxExplicitEventIds")],
  ["delivery route supports test delivery", deliverRoute.includes("testDelivery") && deliverRoute.includes("direct_dm")],
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
