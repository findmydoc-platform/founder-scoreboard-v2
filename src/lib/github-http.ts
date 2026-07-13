export const GITHUB_API_VERSION = "2022-11-28";
export const GITHUB_ISSUE_DEPENDENCY_API_VERSION = "2026-03-10";

export type GitHubOperationKind = "read" | "mutation";

type GitHubApiErrorDetails = {
  status: number;
  method: string;
  requestId?: string | null;
  retryAfterSeconds?: number | null;
  rateLimitRemaining?: number | null;
  rateLimitReset?: number | null;
  retryable?: boolean;
};

export class GitHubApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly requestId: string;
  readonly retryAfterSeconds: number | null;
  readonly rateLimitRemaining: number | null;
  readonly rateLimitReset: number | null;
  readonly retryable: boolean;

  constructor(message: string, details: GitHubApiErrorDetails) {
    super(message);
    this.name = "GitHubApiError";
    this.status = details.status;
    this.method = details.method;
    this.requestId = details.requestId || "";
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
    this.rateLimitRemaining = details.rateLimitRemaining ?? null;
    this.rateLimitReset = details.rateLimitReset ?? null;
    this.retryable = details.retryable === true;
  }
}

type GitHubRequestBaseOptions = {
  token: string;
  body?: unknown;
  apiVersion?: string;
  cache?: RequestCache;
  errorMessage: string;
  allowedStatuses?: readonly number[];
};

type GitHubReadRequestOptions = GitHubRequestBaseOptions & (
  | {
    operation?: "read";
    method?: "GET" | "HEAD";
    body?: never;
    acceptErrorResponse?: boolean;
  }
  | {
    operation: "read";
    method: "POST";
    acceptErrorResponse?: boolean;
  }
);

type GitHubMutationRequestOptions = GitHubRequestBaseOptions & {
  operation: "mutation";
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  acceptErrorResponse?: never;
};

export type GitHubRequestOptions = GitHubReadRequestOptions | GitHubMutationRequestOptions;

type GitHubResponseMetadata = {
  requestId: string;
  retryAfterSeconds: number | null;
  rateLimitRemaining: number | null;
  rateLimitReset: number | null;
};

const maxAutomaticRetryDelaySeconds = 2;
const fallbackReadRetryDelayMs = 250;

function githubHeaders(token: string, apiVersion = GITHUB_API_VERSION) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": apiVersion,
  };
}

function numericHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function retryAfterSeconds(headers: Headers) {
  const value = headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

function responseMetadata(response: Response): GitHubResponseMetadata {
  return {
    requestId: response.headers.get("x-github-request-id") || "",
    retryAfterSeconds: retryAfterSeconds(response.headers),
    rateLimitRemaining: numericHeader(response.headers, "x-ratelimit-remaining"),
    rateLimitReset: numericHeader(response.headers, "x-ratelimit-reset"),
  };
}

function retryableStatus(response: Response, metadata: GitHubResponseMetadata) {
  if ([408, 429, 502, 503, 504].includes(response.status)) return true;
  return response.status === 403 && metadata.retryAfterSeconds !== null;
}

function operationKind(options: GitHubRequestOptions, method: string): GitHubOperationKind {
  if (options.operation) return options.operation;
  if (method === "GET" || method === "HEAD") return "read";
  throw new Error("GitHub POST-, PATCH-, PUT- und DELETE-Anfragen benötigen eine explizite Read- oder Mutation-Klassifizierung.");
}

function validateOperation(options: GitHubRequestOptions, method: string, operation: GitHubOperationKind) {
  if (operation === "mutation" && (method === "GET" || method === "HEAD")) {
    throw new Error("GitHub GET- und HEAD-Anfragen dürfen nicht als Mutation klassifiziert werden.");
  }
  if (operation === "read" && !["GET", "HEAD", "POST"].includes(method)) {
    throw new Error("Nur GitHub GET-, HEAD- und GraphQL-POST-Anfragen dürfen als Read klassifiziert werden.");
  }
  if (operation === "mutation" && options.acceptErrorResponse) {
    throw new Error("GitHub Mutationen dürfen Fehlerantworten nicht ungeprüft akzeptieren.");
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function apiError(message: string, response: Response, method: string, metadata: GitHubResponseMetadata) {
  return new GitHubApiError(message, {
    status: response.status,
    method,
    requestId: metadata.requestId,
    retryAfterSeconds: metadata.retryAfterSeconds,
    rateLimitRemaining: metadata.rateLimitRemaining,
    rateLimitReset: metadata.rateLimitReset,
    retryable: retryableStatus(response, metadata),
  });
}

function networkError(message: string, method: string) {
  return new GitHubApiError(`${message}: Netzwerkfehler`, {
    status: 0,
    method,
    retryable: true,
  });
}

export async function githubRequest(url: string, options: GitHubRequestOptions) {
  if (!options.token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

  const method = (options.method || "GET").toUpperCase();
  const operation = operationKind(options, method);
  validateOperation(options, method, operation);
  const maximumAttempts = operation === "read" ? 2 : 1;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: githubHeaders(options.token, options.apiVersion),
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.cache ? { cache: options.cache } : {}),
      });
    } catch {
      if (attempt < maximumAttempts) {
        await wait(fallbackReadRetryDelayMs);
        continue;
      }
      throw networkError(options.errorMessage, method);
    }

    if (response.ok || options.allowedStatuses?.includes(response.status)) return response;

    const metadata = responseMetadata(response);
    const retryable = retryableStatus(response, metadata);
    const retryDelaySeconds = metadata.retryAfterSeconds ?? (fallbackReadRetryDelayMs / 1000);
    if (
      operation === "read"
      && attempt < maximumAttempts
      && retryable
      && retryDelaySeconds <= maxAutomaticRetryDelaySeconds
    ) {
      await wait(retryDelaySeconds * 1000);
      continue;
    }

    if (options.acceptErrorResponse) return response;
    throw apiError(await githubErrorMessage(response, options.errorMessage), response, method, metadata);
  }

  throw networkError(options.errorMessage, method);
}

export async function githubJson<T>(url: string, options: GitHubRequestOptions) {
  const response = await githubRequest(url, options);
  return response.json() as Promise<T>;
}
