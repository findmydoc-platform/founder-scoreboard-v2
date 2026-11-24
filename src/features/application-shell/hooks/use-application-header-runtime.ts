"use client";

import { useState } from "react";
import { usePlanningHeaderData } from "@/features/planning/hooks/use-planning-header-data";
import { notificationTarget } from "@/features/notifications/model/notification-target";
import { notificationCountSlot } from "@/features/notifications/model/notification-count-slot";
import type { HeaderNotification } from "@/lib/types";
import type { ApplicationHeaderLifecycle, ApplicationNavigation } from "../model/application-header";

export function useApplicationHeaderRuntime(lifecycle: ApplicationHeaderLifecycle, navigation: ApplicationNavigation) {
  const { planningState, enabled, notificationsWorkspace } = lifecycle;
  const [quickLinksOpen, setQuickLinksOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const headerData = usePlanningHeaderData({ planningState, enabled, notificationsWorkspace, previewOpen: notificationsOpen });
  const requestNavigation = navigation.requestNavigation || ((continueNavigation: () => void | Promise<void>) => { void continueNavigation(); });
  const navigate = (href: string) => requestNavigation(() => navigation.navigate(href));
  const openTeam = (editWorkweek = false, week?: string) => {
    const params = new URLSearchParams();
    if (editWorkweek) params.set("workweek", "edit");
    if (week) params.set("week", week);
    navigate(`/team${params.size ? `?${params}` : ""}`);
  };
  const openNotification = (event: HeaderNotification) => {
    planningState.setNotificationPreviewActive(false);
    setNotificationsOpen(false);
    requestNavigation(() => {
      return planningState.updateNotificationStatus(event.id, "seen").then(result => {
        if (result.ok && result.phase === "saved") navigation.navigate(notificationTarget(event).href);
      });
    });
  };
  return {
    headerData,
    notificationCount: enabled ? notificationCountSlot(planningState.notificationCount()) : undefined,
    retryNotificationCount: enabled ? () => { void planningState.refreshNotificationCount(); } : undefined,
    retryNotificationPreview: enabled ? () => { void planningState.refreshHeader(["notifications"]); } : undefined,
    quickLinksOpen,
    retryQuickLinks: enabled ? () => { void planningState.refreshHeader(["quickLinks"]); } : undefined,
    toggleQuickLinks: () => setQuickLinksOpen(value => !value),
    notificationsOpen,
    toggleNotifications: () => {
      planningState.setNotificationPreviewActive(enabled && !notificationsOpen);
      if (!notificationsOpen && enabled) {
        const countStatus = planningState.notificationCount().readStatus;
        if (["not-loaded", "stale", "unavailable"].includes(countStatus)) void planningState.refreshNotificationCount();
        const previewStatus = planningState.header().slots.notifications.readStatus;
        if (["not-loaded", "stale", "unavailable"].includes(previewStatus)) void planningState.refreshHeader(["notifications"]);
      }
      setNotificationsOpen(value => !value);
    },
    openNotification,
    openNotificationCenter: () => { planningState.setNotificationPreviewActive(false); setNotificationsOpen(false); navigate("/notifications"); },
    dismissNotification: (id: number) => { void planningState.updateNotificationStatus(id, "dismiss"); },
    openTeam,
    navigate,
  };
}
