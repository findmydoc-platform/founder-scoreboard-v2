import type { NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { requireMatchingGitHubProviderToken } from "@/lib/github-provider-auth";
import { apiError, authzError } from "@/lib/api-response";

function isAllowedGitHubAssetUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;

    const hostname = url.hostname.toLowerCase();
    if (hostname === "github.com" && url.pathname.includes("/user-attachments/assets/")) return true;
    if (hostname === "user-images.githubusercontent.com") return true;
    if (hostname === "private-user-images.githubusercontent.com") return true;
    if (hostname === "objects.githubusercontent.com") return true;
    if (hostname.endsWith(".githubusercontent.com")) return true;
    if (hostname.startsWith("github-production-user-asset-") && hostname.endsWith(".s3.amazonaws.com")) return true;

    return false;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const permission = await requireFounder(request);
  if (!permission.ok) return authzError(permission);

  const url = request.nextUrl.searchParams.get("url")?.trim() || "";
  if (!isAllowedGitHubAssetUrl(url)) {
    return apiError("Nur GitHub-Bildanhänge dürfen geladen werden.", 400);
  }

  let token = "";
  try {
    token = await requireMatchingGitHubProviderToken(request, permission.profile, "GitHub User-Token ist nicht verfügbar. Bitte erneut mit GitHub anmelden.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub User-Token konnte nicht geprüft werden.";
    const status = message.includes("nicht verfügbar") ? 401 : 403;
    return apiError(message, status);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,*/*",
      authorization: `Bearer ${token}`,
      "user-agent": "Founder Scoreboard v2",
    },
    cache: "no-store",
    redirect: "follow",
  });

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
