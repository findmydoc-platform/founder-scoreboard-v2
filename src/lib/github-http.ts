const defaultGitHubApiVersion = "2022-11-28";

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

type GitHubRequestOptions = {
  token: string;
  method?: string;
  body?: unknown;
  apiVersion?: string;
  cache?: RequestCache;
  errorMessage: string;
  errorType?: "api";
  allowFailure?: boolean;
  allowedStatuses?: readonly number[];
};

function githubHeaders(token: string, apiVersion = defaultGitHubApiVersion) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": apiVersion,
  };
}

async function githubErrorMessage(response: Response, fallback: string) {
  const scopes = response.headers.get("x-oauth-scopes") || "";
  const acceptedScopes = response.headers.get("x-accepted-oauth-scopes") || "";
  const body = await response.json().catch(() => null) as { message?: string } | null;
  const details = [
    body?.message ? `GitHub: ${body.message}` : "",
    scopes ? `Token-Scopes: ${scopes}` : "",
    acceptedScopes ? `Benötigte Scopes: ${acceptedScopes}` : "",
  ].filter(Boolean).join(" | ");
  return `${fallback}: ${response.status}${details ? ` (${details})` : ""}`;
}

export async function githubRequest(url: string, options: GitHubRequestOptions) {
  if (!options.token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: githubHeaders(options.token, options.apiVersion),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.cache ? { cache: options.cache } : {}),
  });
  if (response.ok || options.allowedStatuses?.includes(response.status) || options.allowFailure) return response;

  const message = await githubErrorMessage(response, options.errorMessage);
  if (options.errorType === "api") throw new GitHubApiError(message, response.status);
  throw new Error(message);
}

export async function githubJson<T>(url: string, options: GitHubRequestOptions) {
  const response = await githubRequest(url, options);
  return response.json() as Promise<T>;
}
