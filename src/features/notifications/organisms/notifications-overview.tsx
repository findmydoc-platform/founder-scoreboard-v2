"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { notificationBadgeTone, notificationTypeLabel } from "@/features/notifications/model/notification-display";
import { NotificationOutboxPanel } from "@/features/notifications/organisms/notification-outbox-panel";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { formatDate } from "@/lib/display";
import { notificationLifecycleLabel } from "@/lib/notification-lifecycle";
import { isOperationalLeadRole } from "@/lib/platform";
import type { NotificationDelivery, NotificationEvent, PlanningData, Profile } from "@/lib/types";
import { classNames, UiBadge, UiEmptyState, UiPanel } from "@/shared/atoms/ui-primitives";
import { FilterSegmentedControl } from "@/shared/molecules/filter-toolbar";

type GoogleChatStatusSummary = {
  webhookConfigured: boolean;
  apiConfigured: boolean;
  deliveryEnabled: boolean;
  ready: boolean;
  mode: "direct-dm" | "space-webhook" | "not-configured";
  pending?: number;
};

type PersonalNotificationFilter = "pending" | "done" | "all";

const personalFilterLabels: Record<PersonalNotificationFilter, string> = {
  pending: "Offen",
  done: "Erledigt",
  all: "Alle",
};

function isToday(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.toDateString() === new Date().toDateString();
}

function eventStatusTone(status: NotificationEvent["status"]) {
  if (status === "pending") return "amber";
  if (status === "dismissed" || status === "resolved") return "slate";
  if (status === "sent") return "emerald";
  return "red";
}

function profileName(profiles: Profile[], profileId: string) {
  return profiles.find((profile) => profile.id === profileId)?.name || "";
}

function personalFilterCount(filter: PersonalNotificationFilter, notifications: NotificationEvent[]) {
  if (filter === "all") return notifications.length;
  if (filter === "done") return notifications.filter((event) => isPersonalNotificationDone(event)).length;
  return notifications.filter((event) => event.status === filter).length;
}

function isPersonalNotificationDone(event: NotificationEvent) {
  return event.status === "dismissed" || event.status === "resolved";
}

function shouldShowTypeBadge(type: NotificationEvent["type"]) {
  return notificationTypeLabel(type) !== "Hinweis";
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
      ? data.notificationEvents.filter((event) => (
        event.recipientProfileId === currentProfile.id
        || !event.recipientProfileId && isOperationalLeadRole(currentProfile.platformRole)
      ))
      : data.notificationEvents,
    [currentProfile, data.notificationEvents],
  );
  const filteredPersonalNotifications = personalNotifications.filter((event) => {
    if (personalFilter === "all") return true;
    if (personalFilter === "done") return isPersonalNotificationDone(event);
    return event.status === personalFilter;
  });
  const personalOpenCount = personalNotifications.filter((event) => event.status === "pending").length;
  const personalNewCount = personalNotifications.filter((event) => event.status === "pending" && !event.seenAt).length;
  const personalDoneCount = personalNotifications.filter((event) => isPersonalNotificationDone(event)).length;
  const personalTodayCount = personalNotifications.filter((event) => isToday(event.createdAt)).length;
  const outboxPendingCount = googleChatStatus?.pending ?? data.notificationEvents.filter((event) => event.status === "pending").length;
  const deliveryErrorCount = data.notificationDeliveries.filter((delivery) => delivery.status === "failed").length
    + data.notificationEvents.filter((event) => event.status === "failed").length;

  return (
    <div className="grid min-w-0 gap-4">
      <section className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
        <span><strong className="text-slate-900">{personalNewCount}</strong> neu</span>
        <span><strong className="text-slate-900">{personalOpenCount}</strong> offen</span>
        {canManageOutbox && <span><strong className="text-slate-900">{outboxPendingCount}</strong> im Ausgang</span>}
        {deliveryErrorCount > 0 && <span className="text-red-700"><strong>{deliveryErrorCount}</strong> Fehler</span>}
      </section>

      <div className={classNames("grid min-w-0 gap-4", canManageOutbox && "xl:grid-cols-[minmax(0,1fr)_minmax(360px,400px)]")}>
        <UiPanel padding="none" className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Für mich{currentProfile && isOperationalLeadRole(currentProfile.platformRole) ? " & Team" : ""}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {personalNewCount} neu · {personalOpenCount} offen · {personalDoneCount} erledigt · {personalTodayCount} heute
              </p>
            </div>
            <FilterSegmentedControl
              label="Persönliche Hinweise filtern"
              value={personalFilter}
              options={(["pending", "done", "all"] as PersonalNotificationFilter[]).map((filter) => ({
                value: filter,
                label: personalFilterLabels[filter],
                count: personalFilterCount(filter, personalNotifications),
              }))}
              onChange={setPersonalFilter}
            />
          </div>

          <div className="max-h-[calc(100dvh-18rem)] overflow-auto overscroll-contain">
            <div className="min-w-0">
              {filteredPersonalNotifications.map((event) => {
                const actorName = profileName(data.profiles, event.actorProfileId);
                const showTypeBadge = shouldShowTypeBadge(event.type);
                const task = event.entityType.trim().toLowerCase() === "task"
                  ? data.tasks.find((item) => item.id === event.entityId) || null
                  : null;
                const content = (
                  <>
                    <span className="block truncate font-semibold text-slate-950">{event.title}</span>
                    {event.body && <span className="mt-1 block line-clamp-2 text-sm leading-5 text-slate-600">{event.body}</span>}
                    <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {showTypeBadge && <UiBadge tone={notificationBadgeTone(event.type)} size="xs">{notificationTypeLabel(event.type)}</UiBadge>}
                      {(personalFilter === "all" || event.status === "pending" && event.seenAt) && (
                        <UiBadge tone={eventStatusTone(event.status)} size="xs">{notificationLifecycleLabel(event)}</UiBadge>
                      )}
                      <span>{actorName || "System"}</span>
                      <span>·</span>
                      <span>{formatDate(event.createdAt)}</span>
                    </span>
                  </>
                );
                return (
                  <article key={event.id} className="group relative border-b border-slate-100 last:border-b-0">
                    {task ? (
                      <TaskReferenceLink
                        task={task}
                        onOpenTask={() => onOpenNotification(event)}
                        showIcon={false}
                        layout="block"
                        className="w-full min-w-0 px-4 py-3 pr-12 text-left transition hover:bg-slate-50 hover:no-underline focus-visible:ring-inset"
                      >
                        {content}
                      </TaskReferenceLink>
                    ) : (
                      <button type="button" onClick={() => onOpenNotification(event)} className="block w-full min-w-0 cursor-pointer px-4 py-3 pr-12 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200">
                        {content}
                      </button>
                    )}
                    {event.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => onDismissNotification(event.id)}
                        className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-blue-200 group-hover:opacity-100"
                        aria-label="Notification als erledigt schließen"
                      >
                        <X size={14} />
                      </button>
                    )}
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
