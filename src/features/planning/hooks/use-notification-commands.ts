"use client";

import { useRouter } from "next/navigation";
import type { AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import { workspacePath } from "@/features/planning/model/workspace-routes";
import { navigateAfterNotificationStatusUpdate } from "@/features/notifications/model/notification-navigation";
import { notificationTarget } from "@/features/notifications/model/notification-target";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import type { HeaderNotification } from "@/lib/types";
import { type NotificationUserAction } from "@/lib/notification-lifecycle";

type UseNotificationCommandsOptions = PlanningCommandContext & {
  openTaskPanel: (taskId: string) => void;
  refreshCurrentWorkspaceModel: () => Promise<void>;
  setShowNotifications: (show: boolean) => void;
  setWorkspace: (workspace: AppWorkspace) => void;
  workspace: AppWorkspace;
};

const taskOverlayWorkspaces = new Set<AppWorkspace>(["planning", "backlog", "sprint", "projects"]);

export function useNotificationCommands({
  planningState,
  data,
  openTaskPanel,
  setSaveError,
  setShowNotifications,
  setWorkspace,
  workspace,
}: UseNotificationCommandsOptions) {
  const router = useRouter();

  const updateNotificationStatus = (eventId: number, action: NotificationUserAction): Promise<void> => {
    return planningState.updateNotificationStatus(eventId, action).then(result => {
      if (!result.ok && result.error) setSaveError(result.error);
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
