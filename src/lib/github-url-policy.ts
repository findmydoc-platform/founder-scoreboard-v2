export function isGitHubIssueUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "github.com"
      && !url.username
      && !url.password
      && /^\/[^/]+\/[^/]+\/(?:issues|pull)\/[1-9]\d*(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}
