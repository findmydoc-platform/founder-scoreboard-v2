"use client";

import { useState } from "react";
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
    onOpenTeam: () => void;
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
  const [quickLinksOpen, setQuickLinksOpen] = useState(false);
  const [localNotificationsOpen, setLocalNotificationsOpen] = useState(false);
  const notificationPopoverOpen = notificationsOpen ?? localNotificationsOpen;
  const toggleNotifications = onToggleNotifications || (() => setLocalNotificationsOpen((value) => !value));
  const openTeam = calendar?.onOpenTeam || (() => window.location.assign("/team"));

  return (
    <>
      <FmdToolQuickLinks
        quickLinks={headerData.quickLinks}
        open={quickLinksOpen}
        onToggle={() => setQuickLinksOpen((value) => !value)}
      />
      <HeaderCalendarAction
        apiClient={calendar?.apiClient}
        events={headerData.calendarEvents}
        onOpenTeam={openTeam}
        profiles={calendar?.profiles || []}
      />
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
