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
