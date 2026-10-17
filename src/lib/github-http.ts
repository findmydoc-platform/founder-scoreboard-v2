import type { GitHubInstallationCapability, GitHubUserCapability } from "./credentials";
import type { GitHubRequestOptions as PrivateRequestOptions } from "./credentials/internal/github-http-transport";
export { GitHubApiError, GITHUB_API_VERSION, GITHUB_ISSUE_DEPENDENCY_API_VERSION } from "./github-http-contract";
export type { GitHubOperationKind } from "./github-http-contract";
export type GitHubResourceCredential = GitHubInstallationCapability | GitHubUserCapability;
type BoundOptions<T> = T extends unknown ? Omit<T, "token"> & { token: GitHubResourceCredential } : never;
export type GitHubRequestOptions = BoundOptions<PrivateRequestOptions>;

export async function githubRequest(url: string, options: GitHubRequestOptions) {
  if (!options.token || typeof options.token !== "object" || typeof options.token.request !== "function") throw new Error("Eine gebundene GitHub-Ressource ist erforderlich.");
  const { token, ...request } = options;
  return token.request(url, request);
}
export async function githubJson<T>(url: string, options: GitHubRequestOptions) {
  const response = await githubRequest(url, options);
  return response.json() as Promise<T>;
}
