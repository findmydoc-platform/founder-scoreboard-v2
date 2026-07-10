"use client";

import { useState } from "react";
import { HeaderEventCalendar } from "@/features/events/molecules/header-event-calendar";
import { NotificationInbox } from "@/features/notifications/organisms/notification-inbox";
import { FmdToolQuickLinks } from "@/features/tools/molecules/fmd-tool-quick-links";
import type { HeaderNotification, PlanningHeaderData } from "@/lib/types";

type PlanningHeaderDataActionsProps = {
  headerData: PlanningHeaderData;
  notificationsOpen?: boolean;
  onToggleNotifications?: () => void;
  onOpenNotification?: (event: HeaderNotification) => void;
  onDismissNotification?: (eventId: number) => void;
};

export function PlanningHeaderDataActions({
  headerData,
  notificationsOpen,
  onToggleNotifications,
  onOpenNotification,
  onDismissNotification,
}: PlanningHeaderDataActionsProps) {
  const [quickLinksOpen, setQuickLinksOpen] = useState(false);
  const [localNotificationsOpen, setLocalNotificationsOpen] = useState(false);
  const notificationPopoverOpen = notificationsOpen ?? localNotificationsOpen;
  const toggleNotifications = onToggleNotifications || (() => setLocalNotificationsOpen((value) => !value));

  return (
    <>
      <FmdToolQuickLinks
        quickLinks={headerData.quickLinks}
        open={quickLinksOpen}
        onToggle={() => setQuickLinksOpen((value) => !value)}
      />
      <HeaderEventCalendar events={headerData.calendarEvents} />
      <NotificationInbox
        notifications={headerData.notifications}
        open={notificationPopoverOpen}
        onToggle={toggleNotifications}
        onOpen={onOpenNotification}
        onDismiss={onDismissNotification}
      />
    </>
  );
}
