export type GoogleWorkspaceConnectionState = "not_connected" | "connected" | "reconnect_required";

export type GoogleWorkspaceConnectionStatus = Readonly<{
  state: GoogleWorkspaceConnectionState;
  connectedAt: string | null;
  refreshedAt: string | null;
  lastUsedAt: string | null;
  accessTokenExpiresAt: string | null;
}>;

export function googleWorkspaceConnectionLabel(state: GoogleWorkspaceConnectionState) {
  if (state === "connected") return "Verbunden";
  if (state === "reconnect_required") return "Wiederverbindung erforderlich";
  return "Nicht verbunden";
}

export function googleWorkspaceConnectPath(location: Pick<Location, "pathname" | "search" | "hash">) {
  const next = `${location.pathname}${location.search}${location.hash}` || "/team";
  return `/api/google-workspace/connect?next=${encodeURIComponent(next)}`;
}
