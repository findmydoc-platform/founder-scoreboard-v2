import type { TaskCommentSubmission } from "@/features/tasks/model/task-comment-creation";

export type StoredCommentSubmission = TaskCommentSubmission & { taskId: string; submitted: string };
export type CommentSubmissionStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

export function taskCommentSubmissionStorage(storage: CommentSubmissionStorage | undefined, actor: string) {
  const prefix = `planning:submitted-comments:v1:${encodeURIComponent(actor)}:`;
  function keys() {
    return storage ? Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key?.startsWith(prefix))) : [];
  }
  return {
    load(): StoredCommentSubmission[] {
      try {
        return keys().flatMap(key => {
          try {
            const row = JSON.parse(storage!.getItem(key) || "null");
            return row && row.actor === actor && typeof row.id === "string" && /^[0-9a-f-]{36}$/i.test(row.id)
              && key === prefix + row.id && typeof row.taskId === "string" && row.taskId.length > 0
              && typeof row.submitted === "string" && row.submitted.trim().length >= 2 && row.submitted.trim().length <= 4000
              && typeof row.submittedAt === "string" && Number.isFinite(Date.parse(row.submittedAt))
              ? [{ id: row.id, taskId: row.taskId, submitted: row.submitted.trim(), submittedAt: row.submittedAt }] : [];
          } catch { return []; }
        });
      } catch { return []; }
    },
    capture(row: StoredCommentSubmission) {
      if (storage) storage.setItem(prefix + row.id, JSON.stringify({ ...row, actor }));
    },
    remove(id: string) {
      try { storage?.removeItem(prefix + id); } catch { /* A retained receipt can safely be checked again after reload. */ }
    },
    clear() {
      try { for (const key of keys()) storage!.removeItem(key); } catch { /* Protected views are cleared even if browser storage is unavailable. */ }
    },
  };
}
