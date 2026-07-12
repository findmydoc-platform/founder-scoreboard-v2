"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dispatch, SetStateAction } from "react";
import type { AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import { navigateAfterNotificationStatusUpdate } from "@/features/notifications/model/notification-navigation";
import { notificationTarget } from "@/features/notifications/model/notification-target";
import { persistLocalPlanningData } from "@/features/planning/hooks/use-local-planning-state";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { HeaderNotification, NotificationDelivery, PlanningHeaderData } from "@/lib/types";
import { applyLocalNotificationAction, type NotificationUserAction } from "@/lib/notification-lifecycle";
import { resolveNotificationEvents } from "@/lib/notification-resolution";
import { markPlanningHeaderDataError, markPlanningHeaderDataLoading, mergePlanningHeaderData, normalizePlanningHeaderData } from "@/lib/planning-header-data";

type GoogleChatStatus = {
  webhookConfigured: boolean;
  apiConfigured: boolean;
  deliveryEnabled: boolean;
  ready: boolean;
  mode: "direct-dm" | "space-webhook" | "not-configured";
  pending: number;
};

type UseNotificationCommandsOptions = PlanningCommandContext & {
  openTaskPanel: (taskId: string) => void;
  refreshPlanningData: () => Promise<void>;
  setHeaderData: Dispatch<SetStateAction<PlanningHeaderData>>;
  setShowNotifications: (show: boolean) => void;
  setWorkspace: (workspace: AppWorkspace) => void;
  workspace: AppWorkspace;
};

const taskOverlayWorkspaces = new Set<AppWorkspace>(["planning", "backlog", "reviews", "sprint", "projects"]);

export function useNotificationCommands({
  apiClient,
  data,
  openTaskPanel,
  refreshPlanningData,
  setData,
  setHeaderData,
  setSaveError,
  setShowNotifications,
  setWorkspace,
  source,
  startTransition,
  workspace,
}: UseNotificationCommandsOptions) {
  const router = useRouter();
  const [googleChatStatus, setGoogleChatStatus] = useState<GoogleChatStatus | null>(null);
  const [notificationDispatchMessage, setNotificationDispatchMessage] = useState("");

  const refreshGoogleChatStatus = useCallback(async () => {
    if (source !== "supabase") return;

    try {
      const { response, body } = await planningApi.notificationDeliveryStatusRequest(apiClient);
      if (!response.ok || !body) return;

      setGoogleChatStatus({
        webhookConfigured: Boolean(body.googleChat?.webhookConfigured ?? body.googleChatConfigured),
        apiConfigured: Boolean(body.googleChat?.apiConfigured),
        deliveryEnabled: Boolean(body.googleChat?.deliveryEnabled),
        ready: Boolean(body.googleChat?.ready),
        mode: body.googleChat?.mode || "not-configured",
        pending: body.pending || 0,
      });
    } catch {
      // Settings can still show local queue counts when the status endpoint is unavailable.
    }
  }, [apiClient, source]);

  useEffect(() => {
    if (workspace !== "notifications") return;
    const timeout = window.setTimeout(() => {
      void refreshGoogleChatStatus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refreshGoogleChatStatus, workspace]);

  const runNotificationDelivery = useCallback((payload: Record<string, unknown>, fallbackError: string) => {
    setSaveError("");
    setNotificationDispatchMessage("");

    if (source !== "supabase") {
      setNotificationDispatchMessage("Benachrichtigungsausgang ist in diesem Arbeitsmodus nicht verfügbar.");
      return;
    }

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.runNotificationDeliveryRequest(apiClient, payload);
        if (!response.ok && !body?.error) throw new Error(fallbackError);
        if (!response.ok) throw new Error(body?.error || "Google-Chat-Dispatch konnte nicht ausgeführt werden.");

        setNotificationDispatchMessage(`${body?.sent || 0} gesendet, ${body?.failed || 0} fehlgeschlagen, ${body?.skipped || 0} übersprungen.`);
        await refreshGoogleChatStatus();
        await refreshPlanningData();
      } catch (error) {
        setNotificationDispatchMessage(error instanceof Error ? error.message : "Google-Chat-Dispatch konnte nicht ausgeführt werden.");
      }
    });
  }, [apiClient, refreshGoogleChatStatus, refreshPlanningData, setSaveError, source, startTransition]);

  const dispatchNotifications = () => {
    runNotificationDelivery({ limit: 20 }, "Google-Chat-Dispatch konnte nicht ausgeführt werden.");
  };

  const retryNotificationDelivery = (delivery: NotificationDelivery) => {
    runNotificationDelivery({ eventIds: [delivery.eventId], limit: 1 }, "Google-Chat-Retry konnte nicht ausgeführt werden.");
  };

  const sendGoogleChatTest = (testDelivery: "webhook_digest" | "direct_dm", profileId?: string) => {
    runNotificationDelivery(
      { testDelivery, ...(profileId ? { profileId } : {}), limit: 1 },
      "Google-Chat-Testversand konnte nicht ausgeführt werden.",
    );
  };

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
      if (source === "seed") {
        try {
          persistLocalPlanningData(nextData);
        } catch {
          // Local navigation still works when browser storage is unavailable.
        }
      }
      return nextData;
    });

    if (source !== "supabase") return Promise.resolve();

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
          await refreshPlanningData();
          setSaveError(error instanceof Error ? error.message : "Notification konnte nicht aktualisiert werden.");
        } finally {
          resolve();
        }
      });
    });
  };

  const openNotification = (event: HeaderNotification) => {
    const target = notificationTarget(event);
    if (target.taskId) {
      const task = data.tasks.find((item) => item.id === event.entityId);
      if (!task && taskOverlayWorkspaces.has(workspace)) {
        void updateNotificationStatus(event.id, "seen");
        setSaveError("Die verknüpfte Aufgabe wurde nicht gefunden. Der Hinweis kann geschlossen werden.");
        setShowNotifications(false);
        return;
      }
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
    if (source === "seed") {
      setData((current) => {
        const nextData = resolveNotificationEvents(current).data;
        try {
          persistLocalPlanningData(nextData);
        } catch {
          // Keep the local inbox usable when browser storage is unavailable.
        }
        return nextData;
      });
      return;
    }

    setHeaderData((current) => markPlanningHeaderDataLoading(current, ["notifications"]));
    startTransition(async () => {
      try {
        const { response, body } = await planningApi.requestPlanningHeaderData(apiClient, ["notifications"]);
        if (!response.ok || !body?.headerData) {
          throw new Error(body?.error || "Benachrichtigungen konnten nicht geladen werden.");
        }
        const next = normalizePlanningHeaderData(body.headerData);
        setHeaderData((current) => mergePlanningHeaderData(current, next));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Benachrichtigungen konnten nicht geladen werden.";
        setHeaderData((current) => markPlanningHeaderDataError(current, ["notifications"], message));
      }
    });
  };

  return {
    dismissNotification,
    dispatchNotifications,
    googleChatStatus,
    notificationDispatchMessage,
    openNotificationInbox,
    openNotification,
    retryNotificationDelivery,
    sendGoogleChatTest,
  };
}
