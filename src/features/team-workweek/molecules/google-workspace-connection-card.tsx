"use client";

import { Link2, Unlink2 } from "lucide-react";
import { useState } from "react";
import { useGoogleWorkspaceConnection } from "../hooks/use-google-workspace-connection";
import { GoogleWorkspaceDisconnectDialog } from "./google-workspace-disconnect-dialog";
import { googleWorkspaceConnectionLabel } from "../model/google-workspace-connection";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile } from "@/lib/types";
import { classNames, UiBadge, UiButton, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

export function GoogleWorkspaceConnectionCard({
  apiClient,
  compact = false,
  profile,
}: {
  apiClient: BrowserApiClient;
  compact?: boolean;
  profile: Profile;
}) {
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const {
    callbackError,
    connection,
    disconnectConnection,
    disconnectView,
    load,
    message,
    pending,
    startConnect,
  } = useGoogleWorkspaceConnection(apiClient);
  const connected = connection.state === "connected";
  const reconnect = connection.state === "reconnect_required";
  const cleanupPending = disconnectView.state === "cleanup_pending" || disconnectView.pendingSeriesCount > 0;

  const confirmDisconnect = async () => {
    await disconnectConnection();
    setDisconnectOpen(false);
  };

  return (
    <>
      <UiPanel padding={compact ? "sm" : "md"} aria-labelledby="google-workspace-connection-title">
        <div className={classNames("flex flex-col sm:flex-row sm:items-start sm:justify-between", compact ? "gap-2" : "gap-4")}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="google-workspace-connection-title" className={classNames("font-semibold text-slate-950", compact ? "text-sm" : "text-base")}>
                Google Workspace
              </h2>
              <UiBadge tone={connected ? "emerald" : reconnect ? "amber" : "slate"} size={compact ? "xs" : "md"}>
                {pending ? "Wird geprüft" : googleWorkspaceConnectionLabel(connection.state)}
              </UiBadge>
            </div>
            {!compact && (
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                {profile.name} verbindet den eigenen primären Google-Kalender mit FounderOps. Die Verbindung allein veröffentlicht keine Arbeitswoche und erstellt keine Termine.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {message && (
              <UiButton size={compact ? "sm" : "lg"} onClick={() => void load()} disabled={pending}>
                Erneut prüfen
              </UiButton>
            )}
            {!connected && (
              <UiButton
                variant="emerald"
                size={compact ? "iconMd" : "iconLg"}
                disabled={pending}
                onClick={startConnect}
                aria-label={reconnect ? "Neu verbinden" : "Google verbinden"}
                title={reconnect ? "Neu verbinden" : "Google verbinden"}
              >
                <Link2 size={16} aria-hidden="true" />
              </UiButton>
            )}
            {connected && cleanupPending && (
              <UiButton variant="primary" size={compact ? "sm" : "lg"} disabled={pending} onClick={() => void disconnectConnection()}>
                Bereinigung fortsetzen
              </UiButton>
            )}
            {connected && !cleanupPending && (
              <UiButton
                variant="red"
                size={compact ? "iconMd" : "iconLg"}
                disabled={pending}
                onClick={() => setDisconnectOpen(true)}
                aria-label="Verbindung trennen"
                title="Verbindung trennen"
              >
                <Unlink2 size={16} aria-hidden="true" />
              </UiButton>
            )}
          </div>
        </div>
        {(!compact || message || callbackError || cleanupPending || reconnect) && <div className={compact ? "mt-2" : "mt-4"} aria-live="polite">
          {message || callbackError ? (
            <UiNotice size={compact ? "compact" : "sm"} tone="warning">{message || callbackError}</UiNotice>
          ) : cleanupPending ? (
            <UiNotice size={compact ? "compact" : "sm"} tone="warning">
              Die Teamfreigabe ist inaktiv. {disconnectView.pendingSeriesCount} markierte Google-Serie{disconnectView.pendingSeriesCount === 1 ? " wartet" : "n warten"} noch auf bestätigte Bereinigung.
            </UiNotice>
          ) : reconnect ? (
            <UiNotice size={compact ? "compact" : "sm"} tone="warning">
              Die Freigabe ist abgelaufen oder wurde widerrufen. Verbinde Google erneut, bevor FounderOps Kalendereinträge synchronisiert.
            </UiNotice>
          ) : connected ? (
            <UiNotice size={compact ? "compact" : "sm"} tone="success">
              Zugriff auf eigene Kalendereinträge. OAuth-Tokens bleiben verschlüsselt und serverseitig.
            </UiNotice>
          ) : (
            <UiNotice size={compact ? "compact" : "sm"} tone="neutral">
              Noch keine persönliche Kalenderverbindung. FounderOps kann derzeit keine eigenen Kalendereinträge für dieses Profil verwalten.
            </UiNotice>
          )}
        </div>}
      </UiPanel>
      <GoogleWorkspaceDisconnectDialog
        disconnect={disconnectView}
        open={disconnectOpen}
        pending={pending}
        onCancel={() => setDisconnectOpen(false)}
        onConfirm={() => void confirmDisconnect()}
      />
    </>
  );
}
