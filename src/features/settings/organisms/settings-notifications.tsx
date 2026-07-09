"use client";

import { useState } from "react";
import { formatDate } from "@/lib/display";
import { notificationChannelLabel, shouldSendToGoogleChatDigest, shouldSendToGoogleChatDm } from "@/lib/notification-policy";
import type { NotificationDelivery, PlanningData } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

type GoogleChatStatusSummary = {
  ready: boolean;
  webhookConfigured: boolean;
  apiConfigured: boolean;
  deliveryEnabled: boolean;
  mode: "space-webhook" | "direct-dm" | "not-configured";
};

type DeliveryFilter = "all" | "failed" | "sent" | "direct_dm" | "webhook_digest";

const deliveryFilterLabels: Record<DeliveryFilter, string> = {
  all: "alle",
  failed: "fehlgeschlagen",
  sent: "gesendet",
  direct_dm: "persönlich",
  webhook_digest: "Sammelmeldung",
};

function deliveryModeLabel(mode?: NotificationDelivery["deliveryMode"]) {
  if (mode === "direct_dm") return "Persönlich";
  if (mode === "webhook_digest") return "Sammelmeldung";
  return "ohne Zuordnung";
}

export function SettingsNotificationsSection({
  data,
  pending,
  notificationDispatchMessage,
  googleChatStatus,
  onDispatchNotifications,
  onRetryNotificationDelivery,
  onSendGoogleChatTest,
}: {
  data: PlanningData;
  pending: boolean;
  notificationDispatchMessage: string;
  googleChatStatus: GoogleChatStatusSummary | null;
  onDispatchNotifications: () => void;
  onRetryNotificationDelivery: (delivery: NotificationDelivery) => void;
  onSendGoogleChatTest: (testDelivery: "webhook_digest" | "direct_dm", profileId?: string) => void;
}) {
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("all");
  const pendingNotifications = data.notificationEvents.filter((event) => event.status === "pending");
  const failedNotifications = data.notificationEvents.filter((event) => event.status === "failed");
  const googleChatDigestNotifications = pendingNotifications.filter((event) => shouldSendToGoogleChatDigest(event.type));
  const googleChatDmNotifications = pendingNotifications.filter((event) => event.recipientProfileId && shouldSendToGoogleChatDm(event.type));
  const inAppOnlyNotifications = pendingNotifications.filter((event) => !shouldSendToGoogleChatDigest(event.type));
  const failedDigestNotifications = failedNotifications.filter((event) => shouldSendToGoogleChatDigest(event.type));
  const dmReadyProfiles = data.profiles.filter((profile) => /^spaces\/[A-Za-z0-9_-]+$/.test(profile.googleChatDmSpace || ""));
  const googleChatDmReadyProfiles = dmReadyProfiles.length;
  const failedDirectDmDeliveries = data.notificationDeliveries.filter((delivery) => delivery.status === "failed" && delivery.deliveryMode === "direct_dm");
  const recentDeliveries = data.notificationDeliveries.slice(0, 5);
  const filteredDeliveries = data.notificationDeliveries.filter((delivery) => {
    if (deliveryFilter === "all") return true;
    if (deliveryFilter === "failed" || deliveryFilter === "sent") return delivery.status === deliveryFilter;
    return delivery.deliveryMode === deliveryFilter;
  }).slice(0, 12);
  const googleChatReady = Boolean(googleChatStatus?.ready);
  const googleChatWebhookConfigured = Boolean(googleChatStatus?.webhookConfigured);
  const googleChatApiConfigured = Boolean(googleChatStatus?.apiConfigured);
  const googleChatDeliveryEnabled = Boolean(googleChatStatus?.deliveryEnabled);
  const googleChatModeLabel = googleChatStatus?.mode === "direct-dm" ? "persönliche Hinweise" : googleChatStatus?.mode === "space-webhook" ? "Sammelmeldung" : "nicht verbunden";

  return (
    <>
      <UiPanel className="xl:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Benachrichtigungsausgang</h2>
            <p className="mt-1 text-sm text-slate-500">Wichtige Hinweise werden gesammelt; externe Zustellung läuft nur, wenn sie aktiv verbunden ist.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <UiButton
              disabled={pending || !googleChatReady || !googleChatDigestNotifications.length}
              onClick={onDispatchNotifications}
            >
              Sammelmeldung senden
            </UiButton>
            <UiButton
              disabled={pending || !googleChatWebhookConfigured || !googleChatDeliveryEnabled}
              onClick={() => onSendGoogleChatTest("webhook_digest")}
              variant="blue"
            >
              Test-Sammelmeldung
            </UiButton>
            {dmReadyProfiles.slice(0, 3).map((profile) => (
              <UiButton
                key={profile.id}
                disabled={pending || !googleChatApiConfigured || !googleChatDeliveryEnabled}
                onClick={() => onSendGoogleChatTest("direct_dm", profile.id)}
                className="max-w-48 truncate"
                variant="emerald"
                title={`Direktnachricht an ${profile.name} testen`}
              >
                Direktnachricht: {profile.name}
              </UiButton>
            ))}
          </div>
        </div>
        {!googleChatReady && (
          <UiNotice tone="warning" className="mt-3 break-words">
            Externe Zustellung ist nicht aktiv. Hinweise bleiben in der App, bis ein Admin die Zustellung bewusst verbindet.
          </UiNotice>
        )}
        {googleChatReady && (
          <UiNotice tone="success" className="mt-3 break-words">
            Externe Zustellung ist aktiv. Aktiver Modus: {googleChatModeLabel}.
          </UiNotice>
        )}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sammelmeldung</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{googleChatDigestNotifications.length}</div>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Persönlich</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{googleChatDmNotifications.length}</div>
            <div className="mt-1 text-xs text-slate-500">{googleChatDmReadyProfiles}/{data.profiles.length} Teammitglieder erreichbar</div>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">In der App</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{inAppOnlyNotifications.length}</div>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fehler</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{failedDigestNotifications.length}</div>
          </div>
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-red-700">Persönlich offen</div>
            <div className="mt-1 text-2xl font-semibold text-red-900">{failedDirectDmDeliveries.length}</div>
          </div>
        </div>
        {notificationDispatchMessage && (
          <UiNotice className="mt-3 leading-normal">{notificationDispatchMessage}</UiNotice>
        )}
        <div className="mt-4 grid gap-2">
          {googleChatDigestNotifications.slice(0, 5).map((event) => (
            <div key={event.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{event.title}</span>
                <span className="text-xs text-slate-500">{notificationChannelLabel(event.type)}</span>
              </span>
              <UiBadge tone="amber">pending</UiBadge>
            </div>
          ))}
          {!googleChatDigestNotifications.length && <UiEmptyState>Keine Benachrichtigung wartet auf die Sammelmeldung.</UiEmptyState>}
        </div>
        {inAppOnlyNotifications.length > 0 && (
          <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            {inAppOnlyNotifications.length} Hinweis{inAppOnlyNotifications.length === 1 ? "" : "e"} bleiben bewusst nur in der App.
          </div>
        )}
        <details className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
          <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-slate-500">
            Letzte Sendungen anzeigen
          </summary>
          {recentDeliveries.length > 0 && (
            <div className="mt-3 grid gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Letzte Sendungen</div>
              {recentDeliveries.map((delivery) => (
                <div key={delivery.id} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-xs text-slate-600">
                  <span>{notificationChannelLabel(data.notificationEvents.find((event) => event.id === delivery.eventId)?.type || "system")} · {deliveryModeLabel(delivery.deliveryMode)}</span>
                  <span className="font-semibold">{delivery.status}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sendungen</div>
              <div className="flex flex-wrap gap-1">
                {(["all", "failed", "sent", "direct_dm", "webhook_digest"] as DeliveryFilter[]).map((filter) => (
                  <UiButton
                    key={filter}
                    onClick={() => setDeliveryFilter(filter)}
                    variant={deliveryFilter === filter ? "blue" : "secondary"}
                    size="compact"
                  >
                    {deliveryFilterLabels[filter]}
                  </UiButton>
                ))}
              </div>
            </div>
            {filteredDeliveries.map((delivery) => (
              <div key={delivery.id} className="grid gap-2 rounded-md bg-white px-3 py-2 text-xs text-slate-600 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <span className="font-semibold text-slate-800">Hinweis</span>
                    <span>{notificationChannelLabel(data.notificationEvents.find((event) => event.id === delivery.eventId)?.type || "system")}</span>
                    <span>{deliveryModeLabel(delivery.deliveryMode)}</span>
                    <span>{delivery.digestSize ? `${delivery.digestSize} Hinweis${delivery.digestSize === 1 ? "" : "e"}` : "Einzelversuch"}</span>
                    <span>{formatDate(delivery.createdAt)}</span>
                  </div>
                  {delivery.lastError && <div className="mt-1 line-clamp-2 text-red-700">Zustellung konnte nicht abgeschlossen werden.</div>}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <UiBadge tone={delivery.status === "sent" ? "emerald" : delivery.status === "failed" ? "red" : "amber"} className="font-semibold">
                    {delivery.status}
                  </UiBadge>
                  {delivery.status === "failed" && (
                    <UiButton
                      disabled={pending}
                      onClick={() => onRetryNotificationDelivery(delivery)}
                      size="compact"
                    >
                      Erneut senden
                    </UiButton>
                  )}
                </div>
              </div>
            ))}
            {!filteredDeliveries.length && (
              <UiEmptyState>
                Keine Zustellversuche für diesen Filter.
              </UiEmptyState>
            )}
          </div>
        </details>
      </UiPanel>
    </>
  );
}
