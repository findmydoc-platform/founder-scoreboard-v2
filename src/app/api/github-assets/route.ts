import type { NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { apiError, authzError } from "@/lib/api-response";

import { allowedGitHubAssetUrl } from "@/lib/github-asset-policy";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url")?.trim() || "";
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "assets.github.read", targetId: url });
  if (!permission.ok) return authzError(permission);

  if (!allowedGitHubAssetUrl(url)) {
    return apiError("Nur GitHub-Bildanhänge dürfen geladen werden.", 400);
  }

  let response: Response | null;
  try {
    const result = await permission.resource.readGitHubAsset();
    if (result.kind === "acquisition-failed") return apiError(result.message, 502);
    if (result.kind === "request-failed") return apiError("GitHub-Anhang konnte nicht geladen werden.", 502);
    response = result.response;
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "GitHub-Verbindung konnte nicht geprüft werden.", 502);
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
