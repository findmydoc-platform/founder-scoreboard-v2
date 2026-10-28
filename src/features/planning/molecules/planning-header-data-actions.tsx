"use client";

import { usePlanningBusinessState } from "../hooks/use-planning-business-state";
import { notificationTarget } from "@/features/notifications/model/notification-target";
import { PlanningNotificationFeedback } from "./planning-notification-feedback";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { NotificationInbox } from "@/features/notifications/organisms/notification-inbox";
import { HeaderCalendarAction } from "@/features/planning/molecules/header-calendar-action";
import { FmdToolQuickLinks } from "@/features/tools/molecules/fmd-tool-quick-links";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { HeaderNotification, PlanningHeaderData, Profile } from "@/lib/types";

type PlanningHeaderDataActionsProps = {
  headerData: PlanningHeaderData;
  notificationsOpen?: boolean;
  onToggleNotifications?: () => void;
  onOpenNotification?: (event: HeaderNotification) => void;
  onDismissNotification?: (eventId: number) => void;
  calendar?: Readonly<{
    apiClient?: BrowserApiClient;
    onOpenTeam: (editWorkweek?: boolean, week?: string) => void;
    profiles: Profile[];
  }>;
};

export function PlanningHeaderDataActions({
  headerData,
  notificationsOpen,
  onToggleNotifications,
  onOpenNotification,
  onDismissNotification,
  calendar,
}: PlanningHeaderDataActionsProps) {
  const router = useRouter();
  const planningState = usePlanningBusinessState();
  const [quickLinksOpen, setQuickLinksOpen] = useState(false);
  const [localNotificationsOpen, setLocalNotificationsOpen] = useState(false);
  const notificationPopoverOpen = notificationsOpen ?? localNotificationsOpen;
  const toggleNotifications = onToggleNotifications || (() => setLocalNotificationsOpen((value) => !value));
  const openTeam = calendar?.onOpenTeam || ((editWorkweek = false, week?: string) => {
    const params = new URLSearchParams();
    if (editWorkweek) params.set("workweek", "edit");
    if (week) params.set("week", week);
    router.push(`/team${params.size ? `?${params}` : ""}`);
  });

  return (
    <>
      <PlanningNotificationFeedback />
      <FmdToolQuickLinks
        quickLinks={headerData.quickLinks}
        open={quickLinksOpen}
        onToggle={() => setQuickLinksOpen((value) => !value)}
      />
      <HeaderCalendarAction
        planningState={calendar?.apiClient ? planningState || undefined : undefined}
        events={headerData.calendarEvents}
        onOpenTeam={openTeam}
        profiles={calendar?.profiles || []}
      />
      <NotificationInbox
        notifications={headerData.notifications}
        open={notificationPopoverOpen}
        onToggle={toggleNotifications}
        onOpen={onOpenNotification || (planningState ? event => { void planningState.updateNotificationStatus(event.id, "seen").then(() => router.push(notificationTarget(event).href)); } : undefined)}
        onDismiss={onDismissNotification || (planningState ? eventId => { void planningState.updateNotificationStatus(eventId, "dismiss"); } : undefined)}
      />
    </>
  );
}
