"use client";

import { useEffect, useRef } from "react";
import type { PlanningState } from "../model/planning-state";

export function usePlanningHeaderData({ planningState, enabled, notificationsWorkspace = false, previewOpen = false }: { planningState: PlanningState; enabled: boolean; notificationsWorkspace?: boolean; previewOpen?: boolean }) {
  const countMissing = planningState.notificationCount().readStatus === "not-loaded";
  const inboxMissing = notificationsWorkspace && planningState.notifications().readStatus === "not-loaded";
  // Session replacement can clear the same owner without remounting this header.
  useEffect(() => {
    if (!enabled || document.visibilityState !== "visible") return;
    if (countMissing) void planningState.refreshNotificationCount();
    if (inboxMissing) void planningState.refreshNotifications();
  }, [planningState, enabled, countMissing, inboxMissing]);

  const previousVisit = useRef<{ owner: PlanningState; inbox: boolean } | undefined>(undefined);
  useEffect(() => {
    if (!enabled) { previousVisit.current = undefined; return; }
    const enteringInbox = notificationsWorkspace && (previousVisit.current?.owner !== planningState || !previousVisit.current?.inbox);
    previousVisit.current = { owner: planningState, inbox: notificationsWorkspace };
    planningState.setNotificationPreviewActive(previewOpen);
    planningState.setNotificationInboxActive(notificationsWorkspace);
    const missing = Object.entries(planningState.header().slots).filter(([key, slot]) => (key !== "notifications" || previewOpen) && (slot.readStatus === "not-loaded" || slot.readStatus === "stale")).map(([key]) => key) as import("@/lib/planning-header-data").PlanningHeaderSlotKey[];
    for (const slot of missing) void planningState.refreshHeader([slot]);
    const count = planningState.notificationCount();
    if (count.readStatus === "stale" && document.visibilityState === "visible") void planningState.refreshNotificationCount();
    if (enteringInbox && planningState.notifications().readStatus === "stale" && document.visibilityState === "visible") void planningState.refreshNotifications();
    const demand = { inbox: notificationsWorkspace, preview: previewOpen };
    let controller: AbortController | undefined;
    let interval: number | undefined;
    const refresh = () => {
      if (document.visibilityState === "visible" && controller) void planningState.checkNotificationSource(demand, controller.signal);
    };
    const stop = () => {
      controller?.abort();
      controller = undefined;
      if (interval !== undefined) window.clearInterval(interval);
      interval = undefined;
    };
    const visible = () => {
      if (document.visibilityState !== "visible") { stop(); return; }
      controller ||= new AbortController();
      interval ??= window.setInterval(refresh, 60_000);
      refresh();
    };
    if (document.visibilityState === "visible") {
      controller = new AbortController();
      interval = window.setInterval(refresh, 60_000);
      // A return with usable Inbox content confirms its source, while cold entry uses its pending reads.
      if (enteringInbox && planningState.notifications().readStatus === "current") refresh();
    }
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    return () => {
      planningState.setNotificationPreviewActive(false);
      planningState.setNotificationInboxActive(false);
      stop();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [planningState, enabled, notificationsWorkspace, previewOpen]);
  return planningState.header().data;
}
