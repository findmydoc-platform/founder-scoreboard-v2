import type { NotificationCountView } from "@/features/planning/model/planning-notifications-state";
import type { HeaderDataSlot } from "@/lib/types";

export function notificationCountSlot(view: NotificationCountView): HeaderDataSlot<number | null> {
  if (view.readStatus === "current") return { state: "ready", data: view.value };
  if (view.readStatus === "unavailable" || view.readStatus === "forbidden") return { state: "error", data: null };
  return { state: view.readStatus === "not-loaded" ? "idle" : "loading", data: null };
}
