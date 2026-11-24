import type { DeliverableReviewBasis } from "@/features/reviews/model/deliverable-review-basis";
import type { TaskReviewAdapter, TaskReviewBasisOptions, TaskReviewBasisView } from "@/features/reviews/model/planning-task-review";
import { parseEvidenceUrl } from "@/features/tasks/model/task-evidence-links";
import type { Task } from "@/lib/types";

type Binding = {
  active: boolean;
  userId: string;
  generation: number;
  sessionRevision?: string;
  sessionExpiresAt?: number;
  sourceEpoch: number;
  actor: { id: string; platformRole: string } | null;
};

type Pending = {
  controller: AbortController;
  binding: Binding;
  targetRevision: string;
  result: Promise<boolean>;
  consumers: Set<symbol>;
};

type Entry = {
  view: TaskReviewBasisView;
  receipt?: { basis: DeliverableReviewBasis; binding: Binding; deadline: number };
  pending?: Pending;
  expiry?: ReturnType<typeof setTimeout>;
};

export function createTaskReviewBasisState({ read, binding, now, task, changed }: {
  read: TaskReviewAdapter["readTaskReviewBasis"];
  binding(): Binding;
  now(): number;
  task(taskId: string): Task | undefined;
  changed(): void;
}) {
  const entries = new Map<string, Entry>();
  const sameBinding = (start: Binding, current: Binding) =>
    current.active && start.userId === current.userId && start.generation === current.generation
    && Boolean(start.sessionRevision) && start.sessionRevision === current.sessionRevision
    && start.sessionExpiresAt === current.sessionExpiresAt && start.sourceEpoch === current.sourceEpoch
    && start.actor?.id === current.actor?.id && start.actor?.platformRole === current.actor?.platformRole;

  function current(taskId: string, entry?: Entry) {
    const receipt = entry?.receipt;
    const target = task(taskId);
    return receipt && target && target.updatedAt === receipt.basis.taskUpdatedAt
      && (target.sprintId || null) === receipt.basis.sprintLock.sprintId
      && receipt.deadline > now() && sameBinding(receipt.binding, binding()) ? receipt : undefined;
  }

  function reset(entry: Entry, readStatus: TaskReviewBasisView["readStatus"]) {
    entry.pending?.controller.abort();
    entry.pending = undefined;
    clearTimeout(entry.expiry);
    entry.expiry = undefined;
    entry.receipt = undefined;
    entry.view = { readStatus };
  }

  function expire(entry: Entry) {
    const receipt = entry.receipt;
    if (!receipt) return;
    entry.expiry = setTimeout(() => {
      if (entry.receipt !== receipt) return;
      if (receipt.deadline > now()) { expire(entry); return; }
      reset(entry, "stale");
      changed();
    }, Math.min(receipt.deadline - now(), 2_147_483_647));
  }

  function retain(entry: Entry, pending: Pending, signal?: AbortSignal) {
    const consumer = Symbol();
    pending.consumers.add(consumer);
    const abort = () => {
      pending.consumers.delete(consumer);
      if (entry.pending === pending && !pending.consumers.size) {
        reset(entry, "not-loaded");
        changed();
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    return pending.result.then(accepted => !signal?.aborted && accepted).finally(() => {
      signal?.removeEventListener("abort", abort);
      pending.consumers.delete(consumer);
    });
  }

  async function request(taskId: string, target: Task, entry: Entry, pending: Pending, start: Binding) {
    try {
      if (pending.controller.signal.aborted || !pending.consumers.size) return false;
      const basis = await read!(taskId, { signal: pending.controller.signal });
      if (entry.pending !== pending || pending.controller.signal.aborted || !sameBinding(start, binding())) return false;
      if (task(taskId)?.updatedAt !== target.updatedAt || basis.taskId !== taskId
        || basis.taskUpdatedAt !== target.updatedAt || (target.sprintId || null) !== basis.sprintLock?.sprintId) {
        entry.view = { readStatus: "stale", targetChanged: true };
        return false;
      }
      const deadline = Math.min(basis.readAuthority?.deadline, Date.parse(basis.validUntil), (start.sessionExpiresAt ?? 0) * 1000);
      if (basis.readAuthority?.userId !== start.userId || basis.readActor?.profileId !== start.actor?.id
        || basis.readActor?.platformRole !== start.actor?.platformRole || !basis.sourceRevision
        || !Number.isFinite(deadline) || deadline <= now() || !Number.isFinite(Date.parse(basis.evaluatedAt))
        || Date.parse(basis.evaluatedAt) >= Date.parse(basis.validUntil)
        || !["present", "absent"].includes(basis.evidence?.status)
        || typeof basis.evidence.hasException !== "boolean" || typeof basis.sprintLock.locked !== "boolean"
        || !Array.isArray(basis.evidence.links) || (basis.evidence.status === "present") !== (basis.evidence.links.length > 0)
        || basis.evidence.links.some(link => !link || typeof link.taskId !== "string" || !link.taskId || typeof link.title !== "string"
          || !["evidence", "github_pull_request"].includes(link.kind) || typeof link.url !== "string" || !parseEvidenceUrl(link.url)
          || (link.pullRequest !== undefined && (!link.pullRequest || link.kind !== "github_pull_request"
            || link.pullRequest.url !== link.url || typeof link.pullRequest.title !== "string" || typeof link.pullRequest.repository !== "string"
            || !Number.isSafeInteger(link.pullRequest.number) || link.pullRequest.number <= 0 || !["open", "merged", "closed"].includes(link.pullRequest.status))))
        || (basis.evidence.hasException ? typeof basis.evidence.exceptionNote !== "string" || !basis.evidence.exceptionNote.trim()
          : basis.evidence.exceptionNote !== null)
        || (basis.decision?.status === "blocked" ? !["inactive", "notApproved", "sprintLocked", "evidenceRequired"].includes(basis.decision.reason)
          : basis.decision?.status !== "allowed" || typeof basis.decision.token !== "string" || !basis.decision.token || basis.sprintLock.locked)) {
        entry.view = { readStatus: "unavailable" };
        return false;
      }
      entry.receipt = { basis, binding: start, deadline };
      entry.view = { readStatus: "current", evidence: basis.evidence, sprintLock: basis.sprintLock,
        ...(basis.decision.status === "blocked" ? { blockedReason: basis.decision.reason } : {}) };
      expire(entry);
      return true;
    } catch (error) {
      if (entry.pending !== pending || pending.controller.signal.aborted || !sameBinding(start, binding())) return false;
      const status = (error as { status?: number } | null)?.status;
      entry.view = { readStatus: status === 403 || status === 401 ? "forbidden" : status === 409 || status === 404 ? "stale" : "unavailable" };
      return false;
    } finally {
      if (entry.pending === pending) {
        entry.pending = undefined;
        if (entry.view.readStatus === "loading") entry.view = { readStatus: "stale" };
        changed();
      }
    }
  }

  return {
    view(taskId: string): TaskReviewBasisView | undefined {
      if (!read) return undefined;
      const entry = entries.get(taskId);
      if (!entry) return { readStatus: "not-loaded" };
      return entry.view.readStatus === "current" && !current(taskId, entry) ? { readStatus: "stale" } : entry.view;
    },
    load(taskId: string, options?: TaskReviewBasisOptions): Promise<boolean> {
      const start = binding(), target = task(taskId);
      if (!read || options?.signal?.aborted || !start.active || !start.sessionRevision || !start.actor
        || target?.taskType !== "deliverable" || !target.updatedAt || target.detailAvailability === "summary" || target.detailAvailability === "stale") {
        return Promise.resolve(false);
      }
      const entry = entries.get(taskId) ?? { view: { readStatus: "not-loaded" } };
      entries.set(taskId, entry);
      if (entry.pending && sameBinding(entry.pending.binding, start) && entry.pending.targetRevision === target.updatedAt) {
        return retain(entry, entry.pending, options?.signal);
      }
      if (!options?.refresh && current(taskId, entry)) return Promise.resolve(true);
      reset(entry, "loading");
      const pending: Pending = {
        controller: new AbortController(),
        binding: start,
        targetRevision: target.updatedAt,
        consumers: new Set(),
        result: Promise.resolve().then(() => request(taskId, target, entry, pending, start)),
      };
      entry.pending = pending;
      changed();
      return retain(entry, pending, options?.signal);
    },
    decisionToken(shown: Task): string | undefined {
      const basis = current(shown.id, entries.get(shown.id))?.basis;
      return basis?.taskUpdatedAt === shown.updatedAt && basis?.decision.status === "allowed" ? basis.decision.token : undefined;
    },
    invalidate(taskId: string, denied?: boolean) {
      const entry = entries.get(taskId);
      if (entry) reset(entry, denied ? "forbidden" : "stale");
    },
    clear() {
      for (const entry of entries.values()) reset(entry, "not-loaded");
      entries.clear();
    },
  };
}
