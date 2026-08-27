export function isGitHubAssetUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return hostname === "github.com"
      || hostname === "githubusercontent.com"
      || hostname.endsWith(".githubusercontent.com")
      || /^github-production-user-asset-[a-z0-9-]+\.s3\.amazonaws\.com$/.test(hostname);
  } catch {
    return false;
  }
}
