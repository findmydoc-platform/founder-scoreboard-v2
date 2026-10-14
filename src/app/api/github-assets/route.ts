import type { NextRequest } from "next/server";
import { requirePlanningContributor } from "@/lib/authz";
import { getGitHubAppInstallationToken } from "@/lib/github-app";
import { apiError, authzError } from "@/lib/api-response";

const maxGitHubAssetRedirects = 3;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function allowedGitHubAssetUrl(value: string, base?: URL) {
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

async function fetchGitHubAsset(value: string, token: string) {
  const initialUrl = allowedGitHubAssetUrl(value);
  if (!initialUrl) return null;
  let url: URL = initialUrl;

  for (let redirectCount = 0; redirectCount <= maxGitHubAssetRedirects; redirectCount += 1) {
    const headers = new Headers({
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,*/*",
      "user-agent": "Founder Scoreboard v2",
    });
    if (url.hostname === "github.com") headers.set("authorization", `Bearer ${token}`);

    // This URL passed the asset-host allowlist; every redirect is checked before the next request.
    const response: Response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "manual",
    });

    if (!redirectStatuses.has(response.status)) return response;
    if (redirectCount === maxGitHubAssetRedirects) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    const locationHeader: string | null = response.headers.get("location");
    const nextUrl: URL | null = locationHeader ? allowedGitHubAssetUrl(locationHeader, url) : null;
    await response.body?.cancel().catch(() => undefined);
    if (!nextUrl) return null;
    url = nextUrl;
  }

  return null;
}

export async function GET(request: NextRequest) {
  const permission = await requirePlanningContributor(request);
  if (!permission.ok) return authzError(permission);

  const url = request.nextUrl.searchParams.get("url")?.trim() || "";
  if (!allowedGitHubAssetUrl(url)) {
    return apiError("Nur GitHub-Bildanhänge dürfen geladen werden.", 400);
  }

  let token = "";
  try {
    token = await getGitHubAppInstallationToken();
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub-Verbindung konnte nicht geprüft werden.";
    return apiError(message, 502);
  }

  let response: Response | null;
  try {
    response = await fetchGitHubAsset(url, token);
  } catch {
    return apiError("GitHub-Anhang konnte nicht geladen werden.", 502);
  }
  if (!response) return apiError("GitHub-Anhang konnte nicht sicher geladen werden.", 502);

  if (!response.ok) {
    return apiError(`GitHub-Anhang konnte nicht geladen werden: ${response.status}`, response.status);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    return apiError("Der GitHub-Anhang ist kein unterstütztes Bild.", 415);
  }

  const body = await response.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=300",
    },
  });
}
