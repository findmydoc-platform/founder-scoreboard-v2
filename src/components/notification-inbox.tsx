"use client";

import { Bell, X } from "lucide-react";
import { formatDate } from "@/lib/display";
import type { NotificationEvent, Profile } from "@/lib/types";

function notificationTypeLabel(type: string) {
  if (type === "feedback.bug_reported") return "Bug";
  if (type === "feedback.feature_requested") return "Feature";
  if (type === "task.review_requested") return "Review";
  if (type === "task.review_rework") return "Nacharbeit";
  if (type === "task.review_completed") return "Review erledigt";
  if (type === "task.blocker_reported") return "Blocker";
  if (type === "task.comment") return "Kommentar";
  if (type === "task.proposed") return "Vorschlag";
  if (type === "sprint.task_carried_over") return "Carry-over";
  if (type === "meeting.attendance_updated") return "Meeting";
  if (type.startsWith("decision.")) return "Decision";
  return "Hinweis";
}

function notificationTone(type: string) {
  if (type === "feedback.bug_reported") return "border-red-200 bg-red-50 text-red-700";
  if (type === "feedback.feature_requested") return "border-violet-200 bg-violet-50 text-violet-700";
  if (type === "task.blocker_reported") return "border-red-200 bg-red-50 text-red-700";
  if (type === "task.review_rework") return "border-amber-200 bg-amber-50 text-amber-700";
  if (type === "task.review_requested") return "border-blue-200 bg-blue-50 text-blue-700";
  if (type === "task.review_completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function NotificationInbox({
  notifications,
  profiles,
  open,
  onToggle,
  onOpen,
  onDismiss,
}: {
  notifications: NotificationEvent[];
  profiles: Profile[];
  open: boolean;
  onToggle: () => void;
  onOpen: (event: NotificationEvent) => void;
  onDismiss: (eventId: number) => void;
}) {
  const unreadCount = notifications.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
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
              <p className="mt-0.5 text-xs text-slate-500">Persönliche Hinweise bleiben hier, Google Chat bekommt nur Digests.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{unreadCount}</span>
          </div>
          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-2 sm:max-h-[420px]">
            {notifications.length ? notifications.slice(0, 12).map((event) => {
              const actorName = profiles.find((profile) => profile.id === event.actorProfileId)?.name || "";
              return (
                <article key={event.id} className="group rounded-md border border-transparent p-2 hover:border-slate-100 hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => onOpen(event)} className="min-w-0 flex-1 text-left">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${notificationTone(event.type)}`}>
                        {notificationTypeLabel(event.type)}
                      </span>
                      <span className="mt-1.5 block truncate text-sm font-semibold text-slate-950">{event.title}</span>
                      {event.body && <span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-600">{event.body}</span>}
                      <span className="mt-1 block text-xs text-slate-400">{actorName ? `${actorName} · ` : ""}{formatDate(event.createdAt)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismiss(event.id)}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 opacity-100 hover:bg-white hover:text-slate-700 sm:opacity-0 sm:group-hover:opacity-100"
                      aria-label="Notification schließen"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </article>
              );
            }) : (
              <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                Keine offenen Hinweise.
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
