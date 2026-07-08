"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { NotificationDelivery, NotificationEvent } from "@/lib/types";

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
  setSelectedFeedbackId: (feedbackId: number | null) => void;
  setShowNotifications: (show: boolean) => void;
  setWorkspace: (workspace: AppWorkspace) => void;
  workspace: AppWorkspace;
};

export function useNotificationCommands({
  apiClient,
  data,
  openTaskPanel,
  refreshPlanningData,
  setData,
  setSaveError,
  setSelectedFeedbackId,
  setShowNotifications,
  setWorkspace,
  source,
  startTransition,
  workspace,
}: UseNotificationCommandsOptions) {
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
    if (workspace !== "settings") return;
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

  const openNotification = (event: NotificationEvent) => {
    if (event.entityType === "task") {
      const task = data.tasks.find((item) => item.id === event.entityId);
      if (!task) {
        setSaveError("Die verknüpfte Aufgabe wurde nicht gefunden. Der Hinweis kann geschlossen werden.");
        setShowNotifications(false);
        return;
      }
      openTaskPanel(task.id);
    } else if (event.entityType === "feedback") {
      setSelectedFeedbackId(Number(event.entityId) || null);
      setWorkspace("settings");
    } else if (event.entityType === "meeting") {
      setWorkspace("sprint");
    }
    setShowNotifications(false);
  };

  const dismissNotification = (eventId: number) => {
    setData((current) => ({
      ...current,
      notificationEvents: current.notificationEvents.map((event) => (event.id === eventId ? { ...event, status: "dismissed" } : event)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.dismissNotificationRequest(apiClient, eventId);
        if (!response.ok) throw new Error(body?.error || "Notification konnte nicht geschlossen werden.");
      } catch (error) {
        setData((current) => ({
          ...current,
          notificationEvents: current.notificationEvents.map((event) => (event.id === eventId ? { ...event, status: "pending" } : event)),
        }));
        setSaveError(error instanceof Error ? error.message : "Notification konnte nicht geschlossen werden.");
      }
    });
  };

  return {
    dismissNotification,
    dispatchNotifications,
    googleChatStatus,
    notificationDispatchMessage,
    openNotification,
    retryNotificationDelivery,
    sendGoogleChatTest,
  };
}
