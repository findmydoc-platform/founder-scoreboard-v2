import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { githubUserForToken } from "@/lib/github";

function providerToken(request: NextRequest) {
  return request.headers.get("x-github-provider-token")?.trim() || "";
}

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
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const url = request.nextUrl.searchParams.get("url")?.trim() || "";
  if (!isAllowedGitHubAssetUrl(url)) {
    return NextResponse.json({ error: "Nur GitHub-Bildanhänge dürfen geladen werden." }, { status: 400 });
  }

  const token = providerToken(request);
  if (!token) {
    return NextResponse.json({ error: "GitHub User-Token ist nicht verfügbar. Bitte erneut mit GitHub anmelden." }, { status: 401 });
  }

  const githubUser = await githubUserForToken(token);
  const expectedLogin = permission.profile?.githubLogin?.toLowerCase();
  if (expectedLogin && githubUser.login.toLowerCase() !== expectedLogin) {
    return NextResponse.json({ error: "GitHub User-Token passt nicht zum angemeldeten Teamprofil." }, { status: 403 });
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
    return NextResponse.json({ error: `GitHub-Anhang konnte nicht geladen werden: ${response.status}` }, { status: response.status });
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    return NextResponse.json({ error: "Der GitHub-Anhang ist kein unterstütztes Bild." }, { status: 415 });
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
