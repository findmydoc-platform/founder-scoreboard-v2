"use client";

import { formatDate } from "@/lib/display";
import { notificationChannelLabel, shouldSendToGoogleChatDigest } from "@/lib/notification-policy";
import type { PlanningData } from "@/lib/types";

type GoogleChatStatusSummary = {
  ready: boolean;
  webhookConfigured: boolean;
  apiConfigured: boolean;
  deliveryEnabled: boolean;
  mode: "space-webhook" | "direct-dm" | "not-configured";
};

export function SettingsNotificationsSection({
  data,
  pending,
  feedbackMessage,
  selectedFeedbackId,
  notificationDispatchMessage,
  googleChatStatus,
  onSelectFeedback,
  onDispatchNotifications,
}: {
  data: PlanningData;
  pending: boolean;
  feedbackMessage: string;
  selectedFeedbackId: number | null;
  notificationDispatchMessage: string;
  googleChatStatus: GoogleChatStatusSummary | null;
  onSelectFeedback: (id: number) => void;
  onDispatchNotifications: () => void;
}) {
  const pendingNotifications = data.notificationEvents.filter((event) => event.status === "pending");
  const failedNotifications = data.notificationEvents.filter((event) => event.status === "failed");
  const googleChatDigestNotifications = pendingNotifications.filter((event) => shouldSendToGoogleChatDigest(event.type));
  const inAppOnlyNotifications = pendingNotifications.filter((event) => !shouldSendToGoogleChatDigest(event.type));
  const failedDigestNotifications = failedNotifications.filter((event) => shouldSendToGoogleChatDigest(event.type));
  const recentDeliveries = data.notificationDeliveries.slice(0, 5);
  const googleChatReady = Boolean(googleChatStatus?.ready);
  const googleChatWebhookConfigured = Boolean(googleChatStatus?.webhookConfigured);
  const googleChatApiConfigured = Boolean(googleChatStatus?.apiConfigured);
  const googleChatDeliveryEnabled = Boolean(googleChatStatus?.deliveryEnabled);
  const googleChatModeLabel = googleChatStatus?.mode === "direct-dm" ? "persönliche DMs" : googleChatStatus?.mode === "space-webhook" ? "Space-Digest" : "nicht konfiguriert";
  const selectedFeedback = data.feedbackItems.find((item) => item.id === selectedFeedbackId) || data.feedbackItems[0];
  const openFeedbackCount = data.feedbackItems.filter((item) => item.status === "open").length;

  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Benachrichtigungscenter</h2>
            <p className="mt-1 text-sm text-slate-500">Feedback-Eingang für Bugs und Feature-Wünsche mit Absender, Kontextseite und Detailtext.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">{openFeedbackCount} Feedback offen</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">{googleChatDigestNotifications.length} im Chat-Ausgang</span>
          </div>
        </div>
        {feedbackMessage && (
          <p className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">{feedbackMessage}</p>
        )}
        <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Feedback-Eingang</h3>
                <p className="mt-0.5 text-xs text-slate-500">Neue Bugs und Verbesserungen aus dem Team.</p>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600">{data.feedbackItems.length}</span>
            </div>
            <div className="grid max-h-96 min-w-0 gap-2 overflow-y-auto pr-1">
              {data.feedbackItems.map((item) => {
                const reporter = data.profiles.find((profile) => profile.id === item.profileId)?.name || item.profileId || "Unbekannt";
                const active = selectedFeedback?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectFeedback(item.id)}
                    className={`min-w-0 rounded-md border px-3 py-2 text-left text-sm transition ${active ? "border-blue-200 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-blue-100 hover:bg-blue-50/40"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${item.type === "bug" ? "border-red-200 bg-red-50 text-red-700" : "border-violet-200 bg-violet-50 text-violet-700"}`}>
                        {item.type === "bug" ? "Bug" : "Feature"}
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-slate-500">{item.severity}</span>
                    </div>
                    <div className="mt-2 line-clamp-2 break-words font-semibold text-slate-900">{item.title}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">{reporter} · {formatDate(item.createdAt)}</div>
                  </button>
                );
              })}
              {!data.feedbackItems.length && <div className="grid min-h-48 place-items-center rounded-md border border-dashed border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-500">Noch kein Feedback erfasst.</div>}
            </div>
          </div>
          <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 p-3">
            {selectedFeedback ? (
              <div className="grid min-w-0 gap-3 text-sm">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detail</div>
                  <h3 className="mt-1 break-words text-base font-semibold text-slate-950">{selectedFeedback.title}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">{selectedFeedback.status}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">{selectedFeedback.severity}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">{selectedFeedback.type === "bug" ? "Bug" : "Feature-Wunsch"}</span>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="whitespace-pre-wrap break-words leading-6 text-slate-700">{selectedFeedback.description}</p>
                </div>
                {selectedFeedback.pageUrl && (
                  <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    <span className="font-semibold text-blue-900">Kontextseite: </span>
                    <span className="break-all">{selectedFeedback.pageUrl}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid min-h-48 place-items-center rounded-md border border-dashed border-slate-200 bg-white px-4 text-center text-sm text-slate-500">Feedback auswählen, um Details zu sehen.</div>
            )}
          </div>
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Notification-Ausgang</h2>
            <p className="mt-1 text-sm text-slate-500">Google Chat bekommt nur wichtige Sammelmeldungen. Persönliche Hinweise bleiben oben in der Notification-Inbox.</p>
          </div>
          <button
            type="button"
            disabled={pending || !googleChatReady || !googleChatDigestNotifications.length}
            onClick={onDispatchNotifications}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Digest senden
          </button>
        </div>
        {!googleChatReady && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
            Google Chat sammelt Benachrichtigungen, sendet aber noch nichts. Operative Event Messages bleiben in der App. Release-Details oder Deployment-Zusammenfassungen gehen nur bewusst über die Pipeline raus. Chat API: {googleChatApiConfigured ? "gesetzt" : "fehlt"} · Webhook: {googleChatWebhookConfigured ? "gesetzt" : "fehlt"} · Versandschalter: {googleChatDeliveryEnabled ? "aktiv" : "inaktiv"}. Für persönliche DMs braucht die Umgebung `GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_CHAT_PRIVATE_KEY`, DM-Spaces in den Profilen und `GOOGLE_CHAT_DELIVERY_ENABLED=true`.
          </div>
        )}
        {googleChatReady && (
          <div className="mt-3 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm leading-6 text-emerald-800">
            Google Chat ist versandbereit. Aktiver Modus: {googleChatModeLabel}. Persönliche DMs werden nur an Profile mit `spaces/...` in der Google-Chat-DM-Space gesendet.
          </div>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Chat-Digest</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{googleChatDigestNotifications.length}</div>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nur In-App</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{inAppOnlyNotifications.length}</div>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fehler</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{failedDigestNotifications.length}</div>
          </div>
        </div>
        {notificationDispatchMessage && (
          <p className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">{notificationDispatchMessage}</p>
        )}
        <div className="mt-4 grid gap-2">
          {googleChatDigestNotifications.slice(0, 5).map((event) => (
            <div key={event.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-800">{event.title}</span>
                <span className="text-xs text-slate-500">{event.type} · {event.entityType} · {notificationChannelLabel(event.type)}</span>
              </span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">pending</span>
            </div>
          ))}
          {!googleChatDigestNotifications.length && <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Keine Benachrichtigung wartet auf den Google-Chat-Digest.</div>}
        </div>
        {inAppOnlyNotifications.length > 0 && (
          <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            {inAppOnlyNotifications.length} pending Hinweis{inAppOnlyNotifications.length === 1 ? "" : "e"} bleiben bewusst nur in der In-App-Inbox.
          </div>
        )}
        {recentDeliveries.length > 0 && (
          <div className="mt-4 grid gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Letzte Zustellversuche</div>
            {recentDeliveries.map((delivery) => (
              <div key={delivery.id} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span>{delivery.channel} · Event #{delivery.eventId} · {delivery.target || "kein Ziel"}</span>
                <span className="font-semibold">{delivery.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
