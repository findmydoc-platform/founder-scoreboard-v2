"use client";

import { Bell, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { notificationBadgeTone, notificationTypeLabel } from "@/features/notifications/model/notification-display";
import { notificationTarget } from "@/features/notifications/model/notification-target";
import { formatDate } from "@/lib/display";
import type { HeaderDataSlot, HeaderNotification, HeaderNotificationsData } from "@/lib/types";
import { UiBadge, UiEmptyState } from "@/shared/atoms/ui-primitives";

export function NotificationInbox({
  notifications,
  open,
  onToggle,
  onOpen,
  onDismiss,
}: {
  notifications: HeaderDataSlot<HeaderNotificationsData>;
  open: boolean;
  onToggle: () => void;
  onOpen?: (event: HeaderNotification) => void;
  onDismiss?: (eventId: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.data.unreadCount;
  const items = notifications.data.items;

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target)) onToggle();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onToggle();
    };

    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onToggle]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        aria-label="Benachrichtigungen"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-blue-600 px-1 text-[11px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section className="fixed inset-x-4 top-20 z-50 max-h-[calc(100dvh-6rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[min(92vw,380px)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Notifications</h2>
              <p className="mt-0.5 text-xs text-slate-500">Neue Hinweise. Gesehene bleiben im Notification Center offen.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/notifications"
                className="rounded-md px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                onClick={onToggle}
              >
                Zum Center
              </Link>
              <UiBadge tone="slate" bordered={false}>{unreadCount}</UiBadge>
            </div>
          </div>
          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-2 sm:max-h-[420px]">
            {notifications.state === "loading" ? (
              <UiEmptyState className="px-4 py-8">
                Benachrichtigungen werden geladen.
              </UiEmptyState>
            ) : notifications.state === "error" ? (
              <UiEmptyState className="px-4 py-8">
                {notifications.error || "Benachrichtigungen konnten nicht geladen werden."}
              </UiEmptyState>
            ) : items.length ? items.map((event) => (
                <article key={event.id} className="group rounded-md border border-transparent p-2 hover:border-slate-100 hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => (onOpen || openHeaderNotificationTarget)(event)} className="min-w-0 flex-1 text-left">
                      <UiBadge tone={notificationBadgeTone(event.type)} size="xs" className="text-[11px]">
                        {notificationTypeLabel(event.type)}
                      </UiBadge>
                      <span className="mt-1.5 block truncate text-sm font-semibold text-slate-950">{event.title}</span>
                      {event.body && <span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-600">{event.body}</span>}
                      <span className="mt-1 block text-xs text-slate-400">{formatDate(event.createdAt)}</span>
                    </button>
                    {onDismiss && (
                      <button
                        type="button"
                        onClick={() => onDismiss(event.id)}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 opacity-100 hover:bg-white hover:text-slate-700 sm:opacity-0 sm:group-hover:opacity-100"
                        aria-label="Notification schließen"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </article>
            )) : (
              <UiEmptyState className="px-4 py-8">
                Keine neuen Hinweise.
              </UiEmptyState>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function openHeaderNotificationTarget(event: HeaderNotification) {
  if (typeof window === "undefined") return;
  window.location.assign(notificationTarget(event).href);
}
