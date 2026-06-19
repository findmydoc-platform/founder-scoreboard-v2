import type { NextRequest } from "next/server";
import { githubUserForToken } from "@/lib/github";

type GitHubProfile = {
  githubLogin?: string;
};

export function githubProviderTokenFromRequest(request: NextRequest) {
  return request.headers.get("x-github-provider-token")?.trim() || "";
}

export async function requireMatchingGitHubProviderToken(request: NextRequest, profile: GitHubProfile | null, missingMessage: string) {
  const token = githubProviderTokenFromRequest(request);
  if (!token) throw new Error(missingMessage);

  const githubUser = await githubUserForToken(token);
  const expectedLogin = profile?.githubLogin?.toLowerCase() || "";
  if (!expectedLogin || githubUser.login.toLowerCase() !== expectedLogin) {
    throw new Error("GitHub User-Token passt nicht zum angemeldeten Teamprofil.");
  }

  return token;
}

export async function optionalMatchingGitHubProviderToken(request: NextRequest, profile: GitHubProfile | null) {
  const token = githubProviderTokenFromRequest(request);
  if (!token) return "";

  const githubUser = await githubUserForToken(token);
  const expectedLogin = profile?.githubLogin?.toLowerCase() || "";
  if (!expectedLogin || githubUser.login.toLowerCase() !== expectedLogin) {
    throw new Error("GitHub User-Token passt nicht zum angemeldeten Teamprofil.");
  }

  return token;
}
