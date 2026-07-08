export type GitHubAppConnectionState = "checking" | "connected" | "missing" | "reconnect_required" | "unknown";

export function githubAppConnectionStateFromStatus(status: { connected?: boolean; needsReconnect?: boolean } | null): GitHubAppConnectionState {
  if (!status) return "unknown";
  if (status.connected) return "connected";
  return status.needsReconnect ? "reconnect_required" : "missing";
}
