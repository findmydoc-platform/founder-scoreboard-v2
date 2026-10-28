"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { PlanningState } from "@/features/planning/model/planning-state";
import { googleWorkspaceConnectPath, type GoogleWorkspaceConnectionStatus, type GoogleWorkspaceDisconnectView } from "../model/google-workspace-connection";
import type { GoogleDisconnectBasis } from "../model/google-workspace-state";
const EMPTY_CONNECTION: GoogleWorkspaceConnectionStatus = { state: "not_connected", connectedAt: null, refreshedAt: null, lastUsedAt: null, accessTokenExpiresAt: null };
const EMPTY_DISCONNECT: GoogleWorkspaceDisconnectView = { state: "idle", activePublicationCount: 0, futureSeriesCount: 0, pendingSeriesCount: 0, teamVisibilityWillBeDisabled: false };

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

export function useGoogleWorkspaceConnection(planningState: PlanningState) {
  const view = useSyncExternalStore(planningState.subscribe, planningState.googleWorkspace, planningState.googleWorkspace);
  const callbackError = useSyncExternalStore(subscribeToStaticLocation, callbackErrorFromLocation, () => "");
  const load = useCallback(() => planningState.loadGoogleWorkspace(), [planningState]);
  const disconnecting = view.operation.phase === "disconnecting";
  const awaitingOperation = useRef(false);
  useEffect(() => {
    if (planningState.googleWorkspace().operation.phase === "disconnecting") { awaitingOperation.current = true; return; }
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load, planningState]);
  useEffect(() => {
    if (!disconnecting && awaitingOperation.current) {
      awaitingOperation.current = false;
      if (view.readStatus !== "current") void load();
    }
  }, [disconnecting, view.readStatus, load]);
  const startConnect = useCallback(() => { window.location.assign(googleWorkspaceConnectPath(window.location)); }, []);
  const disconnectConnection = async (basis?: GoogleDisconnectBasis) => {
    const result = basis ? await planningState.disconnectGoogleWorkspace(basis) : await planningState.continueGoogleDisconnect();
    if (result.value?.result) await load();
    return result.value?.result?.state === "completed";
  };
  const operation = view.operation;
  const outcome = operation.phase === "completed" ? "Google-Verbindung getrennt. Die Grundwoche bleibt privat und inaktiv erhalten."
    : operation.phase === "unconfirmed" ? "Die Trennungsbestätigung ist ausstehend. Erneut prüfen lädt nur den aktuellen Stand und wiederholt keine Trennung."
    : operation.phase === "partial" ? operation.result?.recovery === "reconnect" ? "Die Google-Verbindung muss erneuert werden, bevor die Trennung fortgesetzt werden kann."
      : "Die Trennung ist noch nicht vollständig bestätigt. Bereits bestätigte Schritte werden beim nächsten Versuch nicht wiederholt."
    : operation.error;
  return { callbackError, connection: view.connection || EMPTY_CONNECTION, disconnectView: view.preview || { ...EMPTY_DISCONNECT, ...(view.disconnectPending ? { state: "cleanup_pending" as const } : {}) },
    disconnectConnection, load, loadDisconnectPreview: planningState.loadGoogleDisconnectPreview, startConnect,
    pending: ["not-loaded", "loading"].includes(view.readStatus) || operation.phase === "disconnecting",
    unavailable: !view.connection && ["unavailable", "forbidden"].includes(view.readStatus),
    canContinue: view.canContinue, canDisconnect: operation.phase !== "partial" && (operation.phase !== "unconfirmed" || operation.checked && !view.disconnectPending),
    previewWithheld: ["not-loaded", "forbidden"].includes(view.readStatus) || ["not-loaded", "forbidden"].includes(view.previewStatus),
    previewPending: view.previewStatus === "loading", previewReady: view.previewStatus === "current", previewError: view.previewError,
    message: [outcome, view.error].filter(Boolean).join(" "),
  };
}
