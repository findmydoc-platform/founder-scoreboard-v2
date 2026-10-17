import "server-only";

// These bindings permit only completion of accepted work, never new provider work.
export function projectionAccounting() {
  const locks = new Map<string, string>();
  const revisions = new Map<string, string>();
  const lockKey = (body: Record<string, unknown>) => JSON.stringify([body.p_resource_key, body.p_lock_token]);
  const revisionKey = (body: Record<string, unknown>) => JSON.stringify([body.p_task_id, body.p_expected_updated_at]);
  return Object.freeze({
    accepts(name: string, body: Record<string, unknown>) {
      if (name === "release_github_issue_sync_lock") return locks.has(lockKey(body));
      if (name === "finalize_github_issue_sync_with_pull_requests_v1") return revisions.has(revisionKey(body));
      return false;
    },
    observe(name: string, body: Record<string, unknown>, result: unknown) {
      if (name === "try_acquire_github_issue_sync_lock" && typeof body.p_resource_key === "string" && typeof body.p_task_id === "string" && typeof result === "string" && result) {
        locks.set(lockKey({ p_resource_key: body.p_resource_key, p_lock_token: result }), body.p_task_id);
      }
      if (name === "begin_github_issue_sync_transaction_v2" && result && typeof result === "object" && "updated_at" in result && typeof result.updated_at === "string" && result.updated_at) {
        const lock = [...locks].find(([, taskId]) => taskId === body.p_task_id);
        if (lock) revisions.set(revisionKey({ p_task_id: body.p_task_id, p_expected_updated_at: result.updated_at }), lock[0]);
      }
      if (name === "finalize_github_issue_sync_with_pull_requests_v1") revisions.delete(revisionKey(body));
      if (name === "release_github_issue_sync_lock" && result === true) {
        const released = lockKey(body);
        locks.delete(released);
        for (const [revision, lock] of revisions) if (lock === released) revisions.delete(revision);
      }
    },
  });
}
