export type GoogleChatDeliveryStatus = Readonly<{
  webhookConfigured: boolean;
  apiConfigured: boolean;
  deliveryEnabled: boolean;
  ready: boolean;
  mode: "direct-dm" | "space-webhook" | "not-configured";
}>;

export type GoogleChatMessage = Readonly<{ text: string }> | Readonly<{ cardsV2: readonly unknown[] }>;
export type GoogleChatDeliveryCapability = Readonly<{ send(message: GoogleChatMessage): Promise<void> }>;
export type GoogleChatDeliveryInput =
  | { credential: { kind: "google-chat-bot" }; action: "google-chat.space.deliver"; target: string }
  | { credential: { kind: "google-chat-webhook" }; action: "google-chat.webhook.deliver" };
export type GoogleChatStatusInput = { credential: { kind: "google-chat-configuration" }; action: "google-chat.status" };
export type GoogleChatDeliveryResult = Readonly<{ ok: true; chat: GoogleChatDeliveryCapability }>;
