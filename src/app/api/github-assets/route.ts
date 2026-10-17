import { FOUNDEROPS_GITHUB_REPOSITORIES } from "@/lib/github-project-config";
import type { NextRequest } from "next/server";
import { requirePlanningContributor } from "@/lib/authz";
import { authorizeCredentialAction, type GitHubInstallationCapability } from "@/lib/credentials";
import { apiError, authzError } from "@/lib/api-response";

import { allowedGitHubAssetUrl } from "@/lib/github-asset-policy";

export async function GET(request: NextRequest) {
  const permission = await requirePlanningContributor(request);
  if (!permission.ok) return authzError(permission);

  const url = request.nextUrl.searchParams.get("url")?.trim() || "";
  if (!allowedGitHubAssetUrl(url)) {
    return apiError("Nur GitHub-Bildanhänge dürfen geladen werden.", 400);
  }

  let token: GitHubInstallationCapability;
  try {
    token = (await authorizeCredentialAction({ credential: { kind: "github-installation" }, action: "github.asset.read", target: { repositories: FOUNDEROPS_GITHUB_REPOSITORIES, assetUrl: url } })).github;
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub-Verbindung konnte nicht geprüft werden.";
    return apiError(message, 502);
  }

  let response: Response | null;
  try {
    response = await token.asset(url);
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
