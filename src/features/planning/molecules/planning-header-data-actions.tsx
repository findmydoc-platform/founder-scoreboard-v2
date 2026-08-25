"use client";

import { useState } from "react";
import { NotificationInbox } from "@/features/notifications/organisms/notification-inbox";
import { HeaderTeamWorkweekAction } from "@/features/team-workweek/molecules/header-team-workweek-action";
import { FmdToolQuickLinks } from "@/features/tools/molecules/fmd-tool-quick-links";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { HeaderNotification, PlanningHeaderData, Profile } from "@/lib/types";

type PlanningHeaderDataActionsProps = {
  headerData: PlanningHeaderData;
  notificationsOpen?: boolean;
  onToggleNotifications?: () => void;
  onOpenNotification?: (event: HeaderNotification) => void;
  onDismissNotification?: (eventId: number) => void;
  teamWorkweek?: Readonly<{
    apiClient: BrowserApiClient;
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
  teamWorkweek,
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
      {teamWorkweek ? (
        <HeaderTeamWorkweekAction
          apiClient={teamWorkweek.apiClient}
          onOpenTeam={teamWorkweek.onOpenTeam}
          profiles={teamWorkweek.profiles}
        />
      ) : null}
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
