import type { NotificationDelivery, NotificationEvent } from "@/lib/types";
import { UiBadge } from "@/shared/atoms/ui-primitives";
import { UiButton } from "@/shared/atoms/ui-primitives";

function formatDeliveryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function DeliveryStatusRow({ event, delivery, busy, onRetry }: { event: NotificationEvent; delivery?: NotificationDelivery; busy: boolean; onRetry: () => void }) {
  const status = delivery?.status || event.status;
  const tone = status === "sent" ? "emerald" : status === "failed" ? "red" : "amber";
  const label = status === "sent" ? "Zugestellt" : status === "failed" ? "Fehlgeschlagen" : status === "pending" ? "Ausstehend" : status;
  const recipient = delivery?.target || event.recipientProfileId;
  return (
    <article className="grid gap-3 border-b border-slate-100 px-5 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_13rem_7.5rem_9rem] sm:items-center">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-slate-950">{event.title}</h3>
        {recipient && <p className="mt-0.5 truncate text-xs text-slate-500">An {recipient}</p>}
        {delivery?.lastError && <p className="mt-1 line-clamp-2 text-xs text-red-700">{delivery.lastError}</p>}
      </div>
      <time dateTime={event.createdAt} className="text-xs text-slate-500">{formatDeliveryTime(event.createdAt)}</time>
      <UiBadge tone={tone} size="xs" className="justify-self-start">{label}</UiBadge>
      {status === "failed" ? <UiButton variant="blueOutline" size="sm" className="justify-self-start sm:justify-self-stretch" disabled={busy} onClick={onRetry}>Erneut senden</UiButton> : <span className="hidden sm:block" aria-hidden="true" />}
    </article>
  );
}
