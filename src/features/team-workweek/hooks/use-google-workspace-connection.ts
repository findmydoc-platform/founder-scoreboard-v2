"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  googleWorkspaceConnectPath,
  type GoogleWorkspaceConnectionStatus,
  type GoogleWorkspaceDisconnectView,
} from "../model/google-workspace-connection";
import type { BrowserApiClient } from "@/lib/browser-api-client";

const EMPTY_CONNECTION: GoogleWorkspaceConnectionStatus = {
  state: "not_connected",
  connectedAt: null,
  refreshedAt: null,
  lastUsedAt: null,
  accessTokenExpiresAt: null,
};

const EMPTY_DISCONNECT: GoogleWorkspaceDisconnectView = {
  state: "idle",
  activePublicationCount: 0,
  futureSeriesCount: 0,
  pendingSeriesCount: 0,
  teamVisibilityWillBeDisabled: false,
  connectionWillBeRevoked: true,
};

function callbackErrorFromLocation() {
  const result = new URLSearchParams(window.location.search).get("googleWorkspace");
  if (result === "configuration_error") {
    return "Die Google-Verbindung ist noch nicht vollständig konfiguriert.";
  }
  if (result === "connection_error") {
    return "Google konnte nicht verbunden werden. Es wurden keine Zugangsdaten gespeichert.";
  }
  return "";
}

function subscribeToStaticLocation() {
  return () => undefined;
}

export function useGoogleWorkspaceConnection(apiClient: BrowserApiClient, canManage: boolean) {
  const mounted = useRef(true);
  const [connection, setConnection] = useState(EMPTY_CONNECTION);
  const [disconnectView, setDisconnectView] = useState(EMPTY_DISCONNECT);
  const [pending, setPending] = useState(true);
  const [message, setMessage] = useState("");
  const callbackError = useSyncExternalStore(subscribeToStaticLocation, callbackErrorFromLocation, () => "");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setPending(true);
    setMessage("");
    try {
      const statusRequest = apiClient.requestJson<{
        connection?: GoogleWorkspaceConnectionStatus;
        error?: string;
      }>("/api/google-workspace/status", { cache: "no-store", useDevProfileOverride: false });
      const disconnectRequest = canManage
        ? apiClient.requestJson<{ disconnect?: GoogleWorkspaceDisconnectView; error?: string }>(
          "/api/google-workspace/disconnect",
          { cache: "no-store", useDevProfileOverride: false },
        )
        : Promise.resolve(null);
      const [{ response, body }, disconnectResponse] = await Promise.all([statusRequest, disconnectRequest]);
      if (!response.ok || !body?.connection) {
        throw new Error(body?.error || "Google-Verbindungsstatus konnte nicht geladen werden.");
      }
      if (disconnectResponse && (!disconnectResponse.response.ok || !disconnectResponse.body?.disconnect)) {
        throw new Error(disconnectResponse.body?.error || "Trennungsvorschau konnte nicht geladen werden.");
      }
      if (mounted.current) {
        setConnection(body.connection);
        setDisconnectView(disconnectResponse?.body?.disconnect || EMPTY_DISCONNECT);
      }
    } catch (error) {
      if (mounted.current) {
        setMessage(error instanceof Error ? error.message : "Google-Verbindungsstatus konnte nicht geladen werden.");
      }
    } finally {
      if (mounted.current) setPending(false);
    }
  }, [apiClient, canManage]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const startConnect = useCallback(() => {
    window.location.assign(googleWorkspaceConnectPath(window.location));
  }, []);

  const disconnectConnection = async () => {
    setPending(true);
    setMessage("");
    try {
      const { response, body } = await apiClient.requestJson<{
        result?: { state: "completed" | "cleaning" | "cleanup_pending" | "revoke_pending"; recovery: "retry" | "reconnect" | null };
        error?: string;
      }>("/api/google-workspace/disconnect", {
        method: "POST",
        json: { confirm: true },
        useDevProfileOverride: false,
      });
      if ((!response.ok && response.status !== 202) || !body?.result) {
        throw new Error(body?.error || "Google-Verbindung konnte nicht getrennt werden.");
      }
      await load();
      if (mounted.current) {
        setMessage(body.result.state === "completed"
          ? "Google-Verbindung getrennt. Die Grundwoche bleibt privat und inaktiv erhalten."
          : body.result.recovery === "reconnect"
            ? "Der externe Widerruf ist bestätigt. Die Grundwoche ist nicht mehr im Team sichtbar; markierte Serien warten auf eine spätere Bereinigung."
            : "Die Trennung ist noch nicht vollständig bestätigt. Bereits bestätigte Schritte werden beim nächsten Versuch nicht wiederholt.");
      }
      return body.result.state === "completed";
    } catch (error) {
      if (mounted.current) {
        setMessage(error instanceof Error ? error.message : "Google-Verbindung konnte nicht getrennt werden.");
      }
      return false;
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  return { callbackError, connection, disconnectConnection, disconnectView, load, message, pending, startConnect };
}
