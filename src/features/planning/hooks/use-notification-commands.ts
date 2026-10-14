"use client";

import { useRouter } from "next/navigation";
import type { Dispatch, SetStateAction } from "react";
import type { AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import { workspacePath } from "@/features/planning/model/workspace-routes";
import { navigateAfterNotificationStatusUpdate } from "@/features/notifications/model/notification-navigation";
import { notificationTarget } from "@/features/notifications/model/notification-target";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { HeaderNotification, PlanningHeaderData } from "@/lib/types";
import { applyLocalNotificationAction, type NotificationUserAction } from "@/lib/notification-lifecycle";

type UseNotificationCommandsOptions = PlanningCommandContext & {
  openTaskPanel: (taskId: string) => void;
  refreshCurrentWorkspaceModel: () => Promise<void>;
  setHeaderData: Dispatch<SetStateAction<PlanningHeaderData>>;
  setShowNotifications: (show: boolean) => void;
  setWorkspace: (workspace: AppWorkspace) => void;
  workspace: AppWorkspace;
};

const taskOverlayWorkspaces = new Set<AppWorkspace>(["planning", "backlog", "sprint", "projects"]);

export function useNotificationCommands({
  apiClient,
  data,
  openTaskPanel,
  refreshCurrentWorkspaceModel,
  setData,
  setHeaderData,
  setSaveError,
  setShowNotifications,
  setWorkspace,
  startTransition,
  workspace,
}: UseNotificationCommandsOptions) {
  const router = useRouter();

  const updateNotificationStatus = (eventId: number, action: NotificationUserAction): Promise<void> => {
    setHeaderData((current) => {
      const removedHeaderEvent = current.notifications.data.items.some((event) => event.id === eventId);
      return {
        ...current,
        notifications: {
          ...current.notifications,
          data: {
            unreadCount: Math.max(0, current.notifications.data.unreadCount - (removedHeaderEvent ? 1 : 0)),
            items: current.notifications.data.items.filter((event) => event.id !== eventId),
          },
        },
      };
    });
    setData((current) => {
      const nextData = {
        ...current,
        notificationEvents: current.notificationEvents.map((event) => (
          event.id === eventId ? applyLocalNotificationAction(event, action) : event
        )),
      };
      return nextData;
    });

    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          const { response, body } = await planningApi.updateNotificationStatusRequest(apiClient, eventId, action);
          if (!response.ok) throw new Error(body?.error || "Notification konnte nicht aktualisiert werden.");
        } catch (error) {
          setData((current) => ({
            ...current,
            notificationEvents: current.notificationEvents,
          }));
          await refreshCurrentWorkspaceModel();
          setSaveError(error instanceof Error ? error.message : "Notification konnte nicht aktualisiert werden.");
        } finally {
          resolve();
        }
      });
    });
  };

  const openNotification = (event: HeaderNotification) => {
    const target = notificationTarget(event);
    if (event.targetPath) {
      setShowNotifications(false);
      void navigateAfterNotificationStatusUpdate(
        () => updateNotificationStatus(event.id, "seen"),
        () => router.push(target.href),
      );
      return;
    }
    if (target.taskId) {
      const task = data.tasks.find((item) => item.id === event.entityId);
      if (!task || !taskOverlayWorkspaces.has(workspace)) {
        setShowNotifications(false);
        void navigateAfterNotificationStatusUpdate(
          () => updateNotificationStatus(event.id, "seen"),
          () => router.push(target.href),
        );
        return;
      }
      void updateNotificationStatus(event.id, "seen");
      openTaskPanel(task.id);
    } else {
      if (target.href !== workspacePath(target.workspace)) {
        setShowNotifications(false);
        void navigateAfterNotificationStatusUpdate(
          () => updateNotificationStatus(event.id, "seen"),
          () => router.push(target.href),
        );
        return;
      }
      void updateNotificationStatus(event.id, "seen");
      setWorkspace(target.workspace);
    }
    setShowNotifications(false);
  };

  const dismissNotification = (eventId: number) => {
    void updateNotificationStatus(eventId, "dismiss");
  };

  const openNotificationInbox = () => {
    setShowNotifications(true);
  };

  return {
    dismissNotification,
    openNotificationInbox,
    openNotification,
  };
}
