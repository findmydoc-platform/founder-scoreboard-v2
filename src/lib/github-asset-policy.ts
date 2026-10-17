export function allowedGitHubAssetUrl(value: string, base?: URL) {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;

    const hostname = url.hostname.toLowerCase();
    if (hostname === "github.com" && url.pathname.startsWith("/user-attachments/assets/")) return url;
    if (hostname === "user-images.githubusercontent.com") return url;
    if (hostname === "private-user-images.githubusercontent.com") return url;
    if (hostname === "objects.githubusercontent.com") return url;
    if (hostname.endsWith(".githubusercontent.com")) return url;
    if (hostname.startsWith("github-production-user-asset-") && hostname.endsWith(".s3.amazonaws.com")) return url;

    return null;
  } catch {
    return null;
  }
}

