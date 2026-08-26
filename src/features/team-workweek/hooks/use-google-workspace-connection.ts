"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  googleWorkspaceConnectPath,
  type GoogleWorkspaceConnectionStatus,
} from "../model/google-workspace-connection";
import type { BrowserApiClient } from "@/lib/browser-api-client";

const EMPTY_CONNECTION: GoogleWorkspaceConnectionStatus = {
  state: "not_connected",
  connectedAt: null,
  refreshedAt: null,
  lastUsedAt: null,
  accessTokenExpiresAt: null,
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

export function useGoogleWorkspaceConnection(apiClient: BrowserApiClient) {
  const mounted = useRef(true);
  const [connection, setConnection] = useState(EMPTY_CONNECTION);
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
      const { response, body } = await apiClient.requestJson<{
        connection?: GoogleWorkspaceConnectionStatus;
        error?: string;
      }>("/api/google-workspace/status", { cache: "no-store" });
      if (!response.ok || !body?.connection) {
        throw new Error(body?.error || "Google-Verbindungsstatus konnte nicht geladen werden.");
      }
      if (mounted.current) setConnection(body.connection);
    } catch (error) {
      if (mounted.current) {
        setMessage(error instanceof Error ? error.message : "Google-Verbindungsstatus konnte nicht geladen werden.");
      }
    } finally {
      if (mounted.current) setPending(false);
    }
  }, [apiClient]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const startConnect = useCallback(() => {
    window.location.assign(googleWorkspaceConnectPath(window.location));
  }, []);

  return { callbackError, connection, load, message, pending, startConnect };
}
