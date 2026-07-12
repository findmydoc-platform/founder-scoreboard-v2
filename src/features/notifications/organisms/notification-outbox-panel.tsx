"use client";

import { useState } from "react";
import { formatDate } from "@/lib/display";
import { notificationChannelLabel, shouldSendToGoogleChatDigest, shouldSendToGoogleChatDm } from "@/lib/notification-policy";
import type { NotificationDelivery, PlanningData } from "@/lib/types";
import { classNames, UiBadge, UiButton, UiEmptyState, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";
import { FilterSegmentedControl } from "@/shared/molecules/filter-toolbar";

type GoogleChatStatusSummary = {
  ready: boolean;
  webhookConfigured: boolean;
  apiConfigured: boolean;
  deliveryEnabled: boolean;
  mode: "space-webhook" | "direct-dm" | "not-configured";
};

type DeliveryStatusFilter = "all" | "failed" | "sent";
type DeliveryModeFilter = "all" | "direct_dm" | "webhook_digest";

const deliveryStatusLabels: Record<DeliveryStatusFilter, string> = {
  all: "alle",
  failed: "fehlgeschlagen",
  sent: "gesendet",
};

const deliveryModeLabels: Record<DeliveryModeFilter, string> = {
  all: "alle Arten",
  direct_dm: "persönlich",
  webhook_digest: "Sammelmeldung",
};

function deliveryModeLabel(mode?: NotificationDelivery["deliveryMode"]) {
  if (mode === "direct_dm") return "Persönlich";
  if (mode === "webhook_digest") return "Sammelmeldung";
  return "ohne Zuordnung";
}

export function NotificationOutboxPanel({
  data,
  pending,
  notificationDispatchMessage,
  googleChatStatus,
  onDispatchNotifications,
  onRetryNotificationDelivery,
  onSendGoogleChatTest,
  className,
}: {
  data: PlanningData;
  pending: boolean;
  notificationDispatchMessage: string;
  googleChatStatus: GoogleChatStatusSummary | null;
  onDispatchNotifications: () => void;
  onRetryNotificationDelivery: (delivery: NotificationDelivery) => void;
  onSendGoogleChatTest: (testDelivery: "webhook_digest" | "direct_dm", profileId?: string) => void;
  className?: string;
}) {
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<DeliveryStatusFilter>("all");
  const [deliveryModeFilter, setDeliveryModeFilter] = useState<DeliveryModeFilter>("all");
  const [testActionsOpen, setTestActionsOpen] = useState(false);
  const pendingNotifications = data.notificationEvents.filter((event) => event.status === "pending");
  const failedNotifications = data.notificationEvents.filter((event) => event.status === "failed");
  const googleChatDigestNotifications = pendingNotifications.filter((event) => shouldSendToGoogleChatDigest(event.type));
  const googleChatDmNotifications = pendingNotifications.filter((event) => event.recipientProfileId && shouldSendToGoogleChatDm(event.type));
  const inAppOnlyNotifications = pendingNotifications.filter((event) => !shouldSendToGoogleChatDigest(event.type));
  const failedDigestNotifications = failedNotifications.filter((event) => shouldSendToGoogleChatDigest(event.type));
  const dmReadyProfiles = data.profiles.filter((profile) => /^spaces\/[A-Za-z0-9_-]+$/.test(profile.googleChatDmSpace || ""));
  const googleChatDmReadyProfiles = dmReadyProfiles.length;
  const failedDeliveries = data.notificationDeliveries.filter((delivery) => delivery.status === "failed");
  const outboxErrorCount = failedDigestNotifications.length + failedDeliveries.length;
  const recentDeliveries = data.notificationDeliveries.slice(0, 5);
  const filteredDeliveries = data.notificationDeliveries.filter((delivery) => {
    const statusMatches = deliveryStatusFilter === "all" || delivery.status === deliveryStatusFilter;
    const modeMatches = deliveryModeFilter === "all" || delivery.deliveryMode === deliveryModeFilter;
    return statusMatches && modeMatches;
  }).slice(0, 12);
  const googleChatReady = Boolean(googleChatStatus?.ready);
  const googleChatWebhookConfigured = Boolean(googleChatStatus?.webhookConfigured);
  const googleChatApiConfigured = Boolean(googleChatStatus?.apiConfigured);
  const googleChatDeliveryEnabled = Boolean(googleChatStatus?.deliveryEnabled);
  const googleChatModeLabel = googleChatStatus?.mode === "direct-dm" ? "persönliche Hinweise" : googleChatStatus?.mode === "space-webhook" ? "Sammelmeldung" : "nicht verbunden";

  return (
    <UiPanel className={classNames("min-w-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Ausgang</h2>
          <p className="mt-1 text-sm text-slate-500">
            {googleChatReady ? "Zustellung aktiv" : "Zustellung inaktiv"} · {googleChatDigestNotifications.length} Sammelmeldung · {outboxErrorCount} Fehler
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <UiButton
            disabled={pending || !googleChatReady || !googleChatDigestNotifications.length}
            onClick={onDispatchNotifications}
            variant="primary"
          >
            Sammelmeldung senden
          </UiButton>
          <UiButton
            onClick={() => setTestActionsOpen((open) => !open)}
            variant="secondary"
          >
            Testen
          </UiButton>
        </div>
      </div>
      {testActionsOpen && (
        <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Testversand</div>
          <div className="flex flex-wrap gap-2">
            <UiButton
              disabled={pending || !googleChatWebhookConfigured || !googleChatDeliveryEnabled}
              onClick={() => onSendGoogleChatTest("webhook_digest")}
              variant="secondary"
              size="sm"
            >
              Test-Sammelmeldung
            </UiButton>
            {dmReadyProfiles.slice(0, 3).map((profile) => (
              <UiButton
                key={profile.id}
                disabled={pending || !googleChatApiConfigured || !googleChatDeliveryEnabled}
                onClick={() => onSendGoogleChatTest("direct_dm", profile.id)}
                className="max-w-48 truncate"
                variant="secondary"
                size="sm"
                title={`Direktnachricht an ${profile.name} testen`}
              >
                Direktnachricht: {profile.name}
              </UiButton>
            ))}
          </div>
        </div>
      )}
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
      <div className="mt-4 rounded-md border border-slate-100 bg-slate-50 px-3 py-3 text-sm text-slate-600">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <span><strong className="text-slate-950">{googleChatDigestNotifications.length}</strong> Sammelmeldung</span>
          <span><strong className="text-slate-950">{googleChatDmNotifications.length}</strong> persönlich</span>
          <span><strong className="text-slate-950">{inAppOnlyNotifications.length}</strong> in der App</span>
          <span className={outboxErrorCount ? "text-red-700" : ""}>
            <strong>{outboxErrorCount}</strong> Fehler
          </span>
          <span>{googleChatDmReadyProfiles}/{data.profiles.length} DM-ready</span>
        </div>
      </div>
      {notificationDispatchMessage && (
        <UiNotice className="mt-3 leading-normal">{notificationDispatchMessage}</UiNotice>
      )}
      <details className="mt-4 overflow-hidden rounded-lg border border-slate-100 bg-slate-50 p-3">
        <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-slate-500">
          Zustelldetails anzeigen
        </summary>
        <div className="mt-3 grid gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Wartet auf Sammelmeldung</div>
          {googleChatDigestNotifications.slice(0, 5).map((event) => (
            <div key={event.id} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-800">{event.title}</span>
                <span className="text-xs text-slate-500">{notificationChannelLabel(event.type)}</span>
              </span>
              <UiBadge tone="amber">pending</UiBadge>
            </div>
          ))}
          {!googleChatDigestNotifications.length && <UiEmptyState>Keine Benachrichtigung wartet auf die Sammelmeldung.</UiEmptyState>}
        </div>
        {inAppOnlyNotifications.length > 0 && (
          <div className="mt-3 rounded-md border border-slate-100 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
            {inAppOnlyNotifications.length} Hinweis{inAppOnlyNotifications.length === 1 ? "" : "e"} bleiben bewusst nur in der App.
          </div>
        )}
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
            <div className="grid gap-2">
              <FilterSegmentedControl
                label="Sendungen nach Status filtern"
                value={deliveryStatusFilter}
                options={(["all", "failed", "sent"] as DeliveryStatusFilter[]).map((filter) => ({ value: filter, label: deliveryStatusLabels[filter] }))}
                onChange={setDeliveryStatusFilter}
              />
              <FilterSegmentedControl
                label="Sendungen nach Zustellart filtern"
                value={deliveryModeFilter}
                options={(["all", "direct_dm", "webhook_digest"] as DeliveryModeFilter[]).map((filter) => ({ value: filter, label: deliveryModeLabels[filter] }))}
                onChange={setDeliveryModeFilter}
              />
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
  );
}
