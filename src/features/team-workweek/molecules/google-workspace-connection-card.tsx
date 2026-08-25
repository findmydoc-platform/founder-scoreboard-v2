"use client";

import { useGoogleWorkspaceConnection } from "../hooks/use-google-workspace-connection";
import { googleWorkspaceConnectionLabel } from "../model/google-workspace-connection";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile } from "@/lib/types";
import { UiBadge, UiButton, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

export function GoogleWorkspaceConnectionCard({
  apiClient,
  profile,
}: {
  apiClient: BrowserApiClient;
  profile: Profile;
}) {
  const { callbackError, connection, load, message, pending, startConnect } = useGoogleWorkspaceConnection(apiClient);
  const connected = connection.state === "connected";
  const reconnect = connection.state === "reconnect_required";
  const canConnect = profile.platformRole !== "viewer";

  return (
    <UiPanel aria-labelledby="google-workspace-connection-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="google-workspace-connection-title" className="text-base font-semibold text-slate-950">
              Google Workspace
            </h2>
            <UiBadge tone={connected ? "emerald" : reconnect ? "amber" : "slate"} size="md">
              {pending ? "Wird geprüft" : googleWorkspaceConnectionLabel(connection.state)}
            </UiBadge>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            {profile.name} verbindet den eigenen primären Google-Kalender mit FounderOps. Die Verbindung allein veröffentlicht keine Arbeitswoche und erstellt keine Termine.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {message && (
            <UiButton size="lg" onClick={() => void load()} disabled={pending}>
              Erneut prüfen
            </UiButton>
          )}
          {canConnect && !connected && (
            <UiButton
              variant="primary"
              size="lg"
              disabled={pending}
              onClick={startConnect}
            >
              {reconnect ? "Neu verbinden" : "Google verbinden"}
            </UiButton>
          )}
        </div>
      </div>
      <div className="mt-4" aria-live="polite">
        {!canConnect ? (
          <UiNotice tone="neutral">Viewer können den Verbindungsstatus lesen, aber keine persönliche Google-Verbindung ändern.</UiNotice>
        ) : message || callbackError ? (
          <UiNotice tone="warning">{message || callbackError}</UiNotice>
        ) : reconnect ? (
          <UiNotice tone="warning">
            Die Freigabe ist abgelaufen oder wurde widerrufen. Verbinde Google erneut, bevor FounderOps Kalendereinträge synchronisiert.
          </UiNotice>
        ) : connected ? (
          <UiNotice tone="success">
            Zugriff ist auf eigene Kalendereinträge begrenzt. Persönliche OAuth-Tokens bleiben verschlüsselt und ausschließlich serverseitig gespeichert.
          </UiNotice>
        ) : (
          <UiNotice tone="neutral">
            Noch keine persönliche Kalenderverbindung. FounderOps kann derzeit keine eigenen Kalendereinträge für dieses Profil verwalten.
          </UiNotice>
        )}
      </div>
    </UiPanel>
  );
}
