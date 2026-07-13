type GitHubSyncFailureRpcResult = {
  data: Record<string, unknown> | null;
  error: { message?: string } | null;
};

type GitHubSyncFailureRpcClient = {
  rpc: (name: string, params: Record<string, unknown>) => PromiseLike<GitHubSyncFailureRpcResult>;
};

type PersistGitHubSyncFailureOptions = {
  retryDelaysMs?: number[];
  sleep?: (delayMs: number) => Promise<void>;
};

const defaultRetryDelaysMs = [100, 300];

export const githubSyncStatePersistFailedMessage = "GitHub-Sync ist fehlgeschlagen, aber der Status konnte nicht sicher gespeichert werden. Bitte versuche den Sync erneut.";

function defaultSleep(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export async function persistGitHubSyncFailure(
  client: GitHubSyncFailureRpcClient,
  params: {
    taskId: string;
    errorMessage: string;
    activityMessage: string;
  },
  options: PersistGitHubSyncFailureOptions = {},
) {
  const retryDelaysMs = options.retryDelaysMs || defaultRetryDelaysMs;
  const sleep = options.sleep || defaultSleep;
  const attempts = retryDelaysMs.length + 1;
  let lastError = "GitHub sync failure state could not be persisted.";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(retryDelaysMs[attempt - 1]);
    try {
      const result = await client.rpc("fail_github_issue_sync_transaction", {
        p_task_id: params.taskId,
        p_error_message: params.errorMessage,
        p_activity_message: params.activityMessage,
      });
      if (!result.error) return { ok: true as const, data: result.data, attempts: attempt + 1 };
      lastError = result.error.message || lastError;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }

  return { ok: false as const, error: lastError, attempts };
}
