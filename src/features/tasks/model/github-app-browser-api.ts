"use client";

import type { BrowserApiClient } from "@/lib/browser-api-client";

type GitHubAppStatusResponse = {
  installation?: { available?: boolean };
  user?: { connected?: boolean };
  waitingCommentCount?: number;
};

export type GitHubAppBrowserSnapshot = {
  githubInstallationAvailable: boolean;
  githubUserConnected: boolean;
  waitingGitHubCommentCount: number;
};

function currentRelativeUrl() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
}

function unavailableSnapshot(): GitHubAppBrowserSnapshot {
  return {
    githubInstallationAvailable: false,
    githubUserConnected: false,
    waitingGitHubCommentCount: 0,
  };
}

export async function loadGitHubAppBrowserSnapshot(apiClient: BrowserApiClient): Promise<GitHubAppBrowserSnapshot> {
  try {
    const { response, body } = await apiClient.requestJson<GitHubAppStatusResponse>("/api/github-app/status");
    if (!response.ok) return unavailableSnapshot();
    return {
      githubInstallationAvailable: Boolean(body?.installation?.available),
      githubUserConnected: Boolean(body?.user?.connected),
      waitingGitHubCommentCount: Number(body?.waitingCommentCount || 0),
    };
  } catch {
    return unavailableSnapshot();
  }
}

export function startGitHubAppConnect() {
  window.location.assign(`/api/github-app/connect?next=${encodeURIComponent(currentRelativeUrl())}`);
}
