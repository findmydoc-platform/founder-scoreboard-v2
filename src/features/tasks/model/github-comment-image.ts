export function isGitHubAssetUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return hostname === "github.com"
      || hostname.endsWith("githubusercontent.com")
      || hostname === "objects.githubusercontent.com"
      || hostname.startsWith("github-production-user-asset-")
      || hostname.endsWith(".s3.amazonaws.com");
  } catch {
    return false;
  }
}
