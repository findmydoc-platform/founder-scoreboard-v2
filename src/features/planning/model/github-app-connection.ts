export type GitHubUserConnectionState = "checking" | "connected" | "missing" | "reconnect_required" | "unknown";

export function githubUserConnectionStateFromStatus(status: { connected?: boolean; needsReconnect?: boolean } | null): GitHubUserConnectionState {
  if (!status) return "unknown";
  if (status.connected) return "connected";
  return status.needsReconnect ? "reconnect_required" : "missing";
}
