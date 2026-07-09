"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { notificationBadgeTone, notificationTypeLabel } from "@/features/notifications/model/notification-display";
import { NotificationOutboxPanel } from "@/features/notifications/organisms/notification-outbox-panel";
import { formatDate } from "@/lib/display";
import { shouldSendToGoogleChatDigest } from "@/lib/notification-policy";
import type { NotificationDelivery, NotificationEvent, PlanningData, Profile } from "@/lib/types";
import { classNames, UiBadge, UiButton, UiEmptyState, UiPanel } from "@/shared/atoms/ui-primitives";

type GoogleChatStatusSummary = {
  webhookConfigured: boolean;
  apiConfigured: boolean;
  deliveryEnabled: boolean;
  ready: boolean;
  mode: "direct-dm" | "space-webhook" | "not-configured";
  pending?: number;
};

type PersonalNotificationFilter = "pending" | "dismissed" | "all";

const personalFilterLabels: Record<PersonalNotificationFilter, string> = {
  pending: "Offen",
  dismissed: "Erledigt",
  all: "Alle",
};

function isToday(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.toDateString() === new Date().toDateString();
}

function eventStatusTone(status: NotificationEvent["status"]) {
  if (status === "pending") return "amber";
  if (status === "dismissed") return "slate";
  if (status === "sent") return "emerald";
  return "red";
}

function eventStatusLabel(status: NotificationEvent["status"]) {
  if (status === "pending") return "offen";
  if (status === "dismissed") return "erledigt";
  if (status === "sent") return "sent";
  return "failed";
}

function profileName(profiles: Profile[], profileId: string) {
  return profiles.find((profile) => profile.id === profileId)?.name || "";
}

function dmReadyCount(profiles: Profile[]) {
  return profiles.filter((profile) => /^spaces\/[A-Za-z0-9_-]+$/.test(profile.googleChatDmSpace || "")).length;
}

export function NotificationsOverview({
  canManageOutbox,
  currentProfile,
  data,
  pending,
  notificationDispatchMessage,
  googleChatStatus,
  onDispatchNotifications,
  onOpenNotification,
  onDismissNotification,
  onRetryNotificationDelivery,
  onSendGoogleChatTest,
}: {
  canManageOutbox: boolean;
  currentProfile: Profile | null;
  data: PlanningData;
  pending: boolean;
  notificationDispatchMessage: string;
  googleChatStatus: GoogleChatStatusSummary | null;
  onDispatchNotifications: () => void;
  onOpenNotification: (event: NotificationEvent) => void;
  onDismissNotification: (eventId: number) => void;
  onRetryNotificationDelivery: (delivery: NotificationDelivery) => void;
  onSendGoogleChatTest: (testDelivery: "webhook_digest" | "direct_dm", profileId?: string) => void;
}) {
  const [personalFilter, setPersonalFilter] = useState<PersonalNotificationFilter>("pending");
  const personalNotifications = useMemo(
    () => currentProfile
      ? data.notificationEvents.filter((event) => event.recipientProfileId === currentProfile.id)
      : data.notificationEvents,
    [currentProfile, data.notificationEvents],
  );
  const filteredPersonalNotifications = personalNotifications.filter((event) => {
    if (personalFilter === "all") return true;
    return event.status === personalFilter;
  });
  const personalOpenCount = personalNotifications.filter((event) => event.status === "pending").length;
  const personalTodayCount = personalNotifications.filter((event) => isToday(event.createdAt)).length;
  const personalDismissedCount = personalNotifications.filter((event) => event.status === "dismissed").length;
  const googleChatPendingCount = googleChatStatus?.pending ?? data.notificationEvents.filter((event) => event.status === "pending" && shouldSendToGoogleChatDigest(event.type)).length;
  const deliveryErrorCount = data.notificationDeliveries.filter((delivery) => delivery.status === "failed").length
    + data.notificationEvents.filter((event) => event.status === "failed").length;
  const dmReadyProfiles = dmReadyCount(data.profiles);

  const metricCards = [
    { label: "Für mich offen", value: personalOpenCount, detail: `${personalNotifications.length} persönliche Hinweise`, tone: "slate" },
    { label: "Heute", value: personalTodayCount, detail: "neu oder aktualisiert", tone: "slate" },
    ...(canManageOutbox ? [
      { label: "Google Chat pending", value: googleChatPendingCount, detail: "wartet auf Zustellung", tone: "slate" },
      { label: "Fehler", value: deliveryErrorCount, detail: "bestehende Zustellfehler", tone: "red" },
      { label: "DM-ready", value: `${dmReadyProfiles}/${data.profiles.length}`, detail: "Teammitglieder erreichbar", tone: "slate" },
    ] : [
      { label: "Erledigt", value: personalDismissedCount, detail: "geschlossene Hinweise", tone: "slate" },
    ]),
  ];

  return (
    <div className="grid min-w-0 gap-4">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metricCards.map((metric) => (
          <div
            key={metric.label}
            className={classNames(
              "rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm",
              metric.tone === "red" && "border-red-100 bg-red-50",
            )}
          >
            <div className={classNames("text-xs font-semibold uppercase tracking-wide text-slate-500", metric.tone === "red" && "text-red-700")}>{metric.label}</div>
            <div className={classNames("mt-2 text-2xl font-semibold text-slate-950", metric.tone === "red" && "text-red-900")}>{metric.value}</div>
            <div className="mt-1 text-xs text-slate-500">{metric.detail}</div>
          </div>
        ))}
      </section>

      <div className={classNames("grid min-w-0 gap-4", canManageOutbox && "xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.8fr)]")}>
        <UiPanel padding="none" className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Für mich</h2>
              <p className="mt-1 text-sm text-slate-500">Deine persönlichen Hinweise und Updates.</p>
            </div>
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
              {(["pending", "dismissed", "all"] as PersonalNotificationFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setPersonalFilter(filter)}
                  className={classNames(
                    "h-8 min-w-20 rounded px-3 text-sm font-semibold",
                    personalFilter === filter ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                  )}
                  aria-pressed={personalFilter === filter}
                >
                  {personalFilterLabels[filter]}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[calc(100dvh-18rem)] overflow-auto overscroll-contain">
            <div className="min-w-[620px]">
              <div className="grid grid-cols-[88px_minmax(0,1fr)_88px_76px_132px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
                <div>Typ</div>
                <div>Hinweis</div>
                <div>Von</div>
                <div>Zeit</div>
                <div className="text-right">Aktion</div>
              </div>
              {filteredPersonalNotifications.map((event) => {
                const actorName = profileName(data.profiles, event.actorProfileId);
                return (
                  <article key={event.id} className="grid grid-cols-[88px_minmax(0,1fr)_88px_76px_132px] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0">
                    <div className="flex items-start">
                      <UiBadge tone={notificationBadgeTone(event.type)} size="xs">{notificationTypeLabel(event.type)}</UiBadge>
                    </div>
                    <button type="button" onClick={() => onOpenNotification(event)} className="min-w-0 text-left">
                      <span className="block truncate font-semibold text-slate-900">{event.title}</span>
                      {event.body && <span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-600">{event.body}</span>}
                    </button>
                    <div className="truncate text-slate-600">{actorName || "System"}</div>
                    <div className="text-slate-500">{formatDate(event.createdAt)}</div>
                    <div className="flex items-start justify-end gap-2">
                      <UiBadge tone={eventStatusTone(event.status)} size="xs">{eventStatusLabel(event.status)}</UiBadge>
                      <UiButton onClick={() => onOpenNotification(event)} size="compact" variant="blueOutline">
                        Öffnen
                      </UiButton>
                      {event.status === "pending" && (
                        <button
                          type="button"
                          onClick={() => onDismissNotification(event.id)}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                          aria-label="Notification schließen"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
          {!filteredPersonalNotifications.length && (
            <div className="p-4">
              <UiEmptyState minHeight="sm">Keine Hinweise für diesen Filter.</UiEmptyState>
            </div>
          )}
        </UiPanel>

        {canManageOutbox && (
          <NotificationOutboxPanel
            data={data}
            pending={pending}
            notificationDispatchMessage={notificationDispatchMessage}
            googleChatStatus={googleChatStatus}
            onDispatchNotifications={onDispatchNotifications}
            onRetryNotificationDelivery={onRetryNotificationDelivery}
            onSendGoogleChatTest={onSendGoogleChatTest}
          />
        )}
      </div>
    </div>
  );
}
