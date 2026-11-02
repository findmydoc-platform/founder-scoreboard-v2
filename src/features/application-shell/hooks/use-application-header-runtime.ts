"use client";

import { useState } from "react";
import { usePlanningHeaderData } from "@/features/planning/hooks/use-planning-header-data";
import { notificationTarget } from "@/features/notifications/model/notification-target";
import { navigateAfterNotificationStatusUpdate } from "@/features/notifications/model/notification-navigation";
import type { HeaderNotification } from "@/lib/types";
import type { ApplicationHeaderLifecycle, ApplicationNavigation } from "../model/application-header";

export function useApplicationHeaderRuntime(lifecycle: ApplicationHeaderLifecycle, navigation: ApplicationNavigation) {
  const { planningState, enabled, notificationsWorkspace } = lifecycle;
  const headerData = usePlanningHeaderData({ planningState, enabled, notificationsWorkspace });
  const [quickLinksOpen, setQuickLinksOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const openTeam = (editWorkweek = false, week?: string) => {
    const params = new URLSearchParams();
    if (editWorkweek) params.set("workweek", "edit");
    if (week) params.set("week", week);
    navigation.navigate(`/team${params.size ? `?${params}` : ""}`);
  };
  const openNotification = (event: HeaderNotification) => {
    setNotificationsOpen(false);
    void navigateAfterNotificationStatusUpdate(
      async () => { await planningState.updateNotificationStatus(event.id, "seen"); },
      () => navigation.navigate(notificationTarget(event).href),
    );
  };
  return {
    headerData,
    quickLinksOpen,
    toggleQuickLinks: () => setQuickLinksOpen(value => !value),
    notificationsOpen,
    toggleNotifications: () => setNotificationsOpen(value => !value),
    openNotification,
    dismissNotification: (id: number) => { void planningState.updateNotificationStatus(id, "dismiss"); },
    openTeam,
  };
}
