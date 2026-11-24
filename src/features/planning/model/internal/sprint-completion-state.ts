import type { SprintCompletionRead, SprintCompletionSource } from "@/features/sprint/model/sprint-completion-read";
import type { SprintLockBasis } from "@/features/sprint/model/sprint-lock";
import type { PlanningReadStatus } from "../planning-state";

type CompletionRequest<T> = (id: string, options: { signal: AbortSignal }) => Promise<T>;
type UseCompletion = { signal?: AbortSignal; refresh?: boolean };
type Binding = {
  active: boolean;
  userId: string;
  generation: number;
  sessionRevision?: string;
  sessionExpiresAt?: number;
  sourceEpoch: number;
  actor: { id: string; platformRole: string } | null;
};
type Receipt = { read: SprintCompletionRead; binding: Binding; deadline: number; revision: number };
type Pending = { binding: Binding; kind: "content" | "source"; controller: AbortController; result: Promise<boolean>; consumers: Set<symbol> };
type Entry = { readStatus: PlanningReadStatus; receipt?: Receipt; pending?: Pending; expiry?: ReturnType<typeof setTimeout> };
type BlockedReason = Extract<SprintCompletionRead["decision"], { status: "blocked" }>["reason"];

export type SprintCompletionView = Readonly<
  { readStatus: Exclude<PlanningReadStatus, "current"> }
  | { readStatus: "current"; basis: SprintLockBasis; revision: number; reviewDueAt: string | null;
      openObjections: number; nextSprintId: string | null; blockedReason?: BlockedReason }
>;

export function createSprintCompletionState({ read, observe, binding, canRead, now, changed }: {
  read?: CompletionRequest<SprintCompletionRead>;
  observe?: CompletionRequest<SprintCompletionSource>;
  binding(): Binding;
  canRead(id: string): boolean;
  now(): number;
  changed(): void;
}) {
  const entries = new Map<string, Entry>();
  let revision = 0;

  const sameBinding = (start: Binding, current: Binding) =>
    current.active && start.generation === current.generation && start.userId === current.userId
    && Boolean(start.sessionRevision) && start.sessionRevision === current.sessionRevision
    && start.sessionExpiresAt === current.sessionExpiresAt && start.sourceEpoch === current.sourceEpoch
    && current.actor?.platformRole === "ceo" && start.actor?.id === current.actor.id;

  function current(id: string, entry = entries.get(id)) {
    const receipt = entry?.receipt;
    return canRead(id) && receipt && receipt.deadline > now() && sameBinding(receipt.binding, binding()) ? receipt : undefined;
  }

  function clearReceipt(entry: Entry) {
    clearTimeout(entry.expiry);
    entry.expiry = undefined;
    entry.receipt = undefined;
  }

  function cancel(entry: Entry) {
    const prior = entry.pending;
    entry.pending = undefined;
    prior?.controller.abort();
  }

  function expire(entry: Entry, receipt: Receipt) {
    entry.expiry = setTimeout(() => {
      if (entry.receipt !== receipt) return;
      if (receipt.deadline > now()) { expire(entry, receipt); return; }
      clearReceipt(entry);
      cancel(entry);
      entry.readStatus = "stale";
      changed();
    }, Math.max(0, Math.min(receipt.deadline - now(), 2_147_483_647)));
  }

  function retain(entry: Entry, pending: Pending, signal?: AbortSignal) {
    const consumer = Symbol();
    pending.consumers.add(consumer);
    const abort = () => {
      pending.consumers.delete(consumer);
      if (entry.pending !== pending || pending.consumers.size) return;
      cancel(entry);
      if (entry.readStatus === "loading") { entry.readStatus = "not-loaded"; changed(); }
    };
    signal?.addEventListener("abort", abort, { once: true });
    return pending.result.then(ok => ok && !signal?.aborted).finally(() => {
      pending.consumers.delete(consumer);
      signal?.removeEventListener("abort", abort);
    });
  }

  function validSource(id: string, source: SprintCompletionSource, start: Binding) {
    return source?.sprintId === id && typeof source.sourceRevision === "string" && source.sourceRevision
      && source.readActor?.profileId === start.actor?.id && source.readActor?.platformRole === "ceo"
      && source.readAuthority?.userId === start.userId && Number.isFinite(source.readAuthority.deadline) && source.readAuthority.deadline > now();
  }

  function validate(read: SprintCompletionRead, id: string) {
    if (read.basis?.sprint?.id !== id || !read.basis.sprint.updatedAt || !Array.isArray(read.basis.tasks)
      || new Set(read.basis.tasks.map(task => task?.id)).size !== read.basis.tasks.length
      || read.basis.tasks.some(task => !task?.id || typeof task.title !== "string" || !task.updatedAt)
      || !Number.isSafeInteger(read.openObjections) || read.openObjections < 0
      || (read.reviewDueAt !== null && !Number.isFinite(Date.parse(read.reviewDueAt)))
      || (read.nextSprintId !== null && typeof read.nextSprintId !== "string")) return false;
    if (read.decision?.status === "blocked" && read.decision.reason === "alreadyLocked") return read.basis.sprint.scoreLocked;
    if (read.tasksComplete !== true || read.basis.sprint.scoreLocked) return false;
    if (read.decision?.status === "ready") {
      return read.openObjections === 0
        && typeof read.decision.token === "string" && read.decision.token.length > 0 && read.decision.token.length <= 4096;
    }
    return read.decision?.status === "blocked" && ["reviewWindow", "objections", "invalidSchedule"].includes(read.decision.reason);
  }

  function begin(id: string, kind: Pending["kind"], options?: UseCompletion): Promise<boolean> {
    const start = binding();
    if (!read || !sameBinding(start, start) || !canRead(id) || options?.signal?.aborted) return Promise.resolve(false);
    const entry: Entry = entries.get(id) ?? { readStatus: "not-loaded" };
    entries.set(id, entry);
    const previous = current(id, entry);
    if (kind === "source" && (!observe || !previous)) return Promise.resolve(false);
    if (entry.pending && sameBinding(entry.pending.binding, start) && (entry.pending.kind === kind || kind === "source")) {
      return retain(entry, entry.pending, options?.signal);
    }
    if (kind === "content" && previous && !options?.refresh) return Promise.resolve(true);
    cancel(entry);
    if (kind === "content") { clearReceipt(entry); entry.readStatus = "loading"; }
    const pending: Pending = {
      binding: start, kind, controller: new AbortController(), consumers: new Set(),
      result: Promise.resolve().then(async () => {
        const live = () => entry.pending === pending && !pending.controller.signal.aborted && canRead(id) && sameBinding(start, binding());
        const fail = (status: PlanningReadStatus) => { clearReceipt(entry); entry.readStatus = status; return false; };
        try {
          if (!live() || pending.consumers.size === 0) return false;
          const request = { signal: pending.controller.signal };
          if (kind === "source") {
            const source = await observe!(id, request);
            if (!live()) return false;
            if (!validSource(id, source, start)) return fail("unavailable");
            return previous === current(id, entry) && previous?.read.sourceRevision === source.sourceRevision || fail("stale");
          }
          const observed = await read(id, request);
          if (!live()) return false;
          if (!validSource(id, observed, start) || !validate(observed, id)) return fail("unavailable");
          const evaluated = Date.parse(observed.evaluatedAt), until = Date.parse(observed.validUntil);
          const deadline = Math.min(observed.readAuthority.deadline, until, (start.sessionExpiresAt ?? 0) * 1000);
          if (!Number.isFinite(evaluated) || !Number.isFinite(deadline) || until <= evaluated || deadline <= now()) return fail("stale");
          const receipt = { read: observed, binding: start, deadline, revision: ++revision };
          clearReceipt(entry);
          entry.receipt = receipt;
          entry.readStatus = "current";
          expire(entry, receipt);
          return true;
        } catch (error) {
          const status = (error as { status?: number } | null)?.status;
          return live() && fail(status === 403 || status === 401 ? "forbidden" : status === 409 || status === 404 ? "stale" : "unavailable");
        } finally {
          if (entry.pending === pending) {
            entry.pending = undefined;
            if (entry.readStatus === "loading") entry.readStatus = "stale";
            changed();
          }
        }
      }),
    };
    entry.pending = pending;
    changed();
    return retain(entry, pending, options?.signal);
  }

  return {
    view(id: string): SprintCompletionView | undefined {
      if (!read) return undefined;
      const entry = entries.get(id);
      const receipt = current(id, entry);
      if (!receipt) return { readStatus: !entry ? "not-loaded" : entry.readStatus === "current" ? "stale" : entry.readStatus };
      const { basis, reviewDueAt, openObjections, nextSprintId, decision } = receipt.read;
      return { readStatus: "current", basis, revision: receipt.revision, reviewDueAt, openObjections, nextSprintId,
        ...(decision.status === "blocked" ? { blockedReason: decision.reason } : {}) };
    },
    current,
    load: (id: string, options?: UseCompletion) => begin(id, "content", options),
    check: (id: string, options?: UseCompletion) => begin(id, "source", options),
    invalidate(id?: string) {
      for (const [sprintId, entry] of entries) {
        if (id && sprintId !== id) continue;
        cancel(entry);
        clearReceipt(entry);
        entry.readStatus = "stale";
      }
    },
    clear() {
      for (const entry of entries.values()) { cancel(entry); clearReceipt(entry); }
      entries.clear();
    },
  };
}
