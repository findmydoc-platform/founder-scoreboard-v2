import type { SprintAssessmentReceipt, SprintAssessmentSource } from "@/features/sprint/model/sprint-assessment-read";
import type { SprintScoreRow } from "@/features/sprint/model/sprint-score-table-view-model";
import type { PlanningReadStatus } from "../planning-state";

type SprintAssessmentOptions = { signal?: AbortSignal; refresh?: boolean };
export type SprintAssessmentView = Readonly<
  { readStatus: "current"; scoreRows: readonly SprintScoreRow[]; scoreLocked: boolean }
  | { readStatus: Exclude<PlanningReadStatus, "current">; scoreRows: null }
>;
type AssessmentRequest<T> = (id: string, options: { signal: AbortSignal }) => Promise<T>;
type Binding = {
  active: boolean;
  userId: string;
  generation: number;
  sessionRevision?: string;
  sessionExpiresAt?: number;
  sourceEpoch: number;
  actor: { id: string; platformRole: string } | null;
};
type Entry = {
  status: PlanningReadStatus;
  basis?: { receipt: SprintAssessmentReceipt; binding: Binding; deadline: number };
  pending?: { binding: Binding; area: "content" | "source"; controller: AbortController; promise: Promise<boolean>; listeners: Set<symbol> };
  expiry?: ReturnType<typeof setTimeout>;
};

export function createSprintAssessmentState({ read, observe, binding, canRead, now, nextSequence, acceptCommitments, changed }: {
  read?: AssessmentRequest<SprintAssessmentReceipt>;
  observe?: AssessmentRequest<SprintAssessmentSource>;
  binding(): Binding;
  canRead(sprintId: string): boolean;
  now(): number;
  nextSequence(): number;
  acceptCommitments(receipt: SprintAssessmentReceipt, started: number): boolean;
  changed(): void;
}) {
  const entries = new Map<string, Entry>();
  const sameBinding = (start: Binding, current: Binding) =>
    current.active && start.userId === current.userId && start.generation === current.generation
    && Boolean(start.sessionRevision) && start.sessionRevision === current.sessionRevision
    && start.sessionExpiresAt === current.sessionExpiresAt && start.sourceEpoch === current.sourceEpoch
    && start.actor?.id === current.actor?.id && start.actor?.platformRole === current.actor?.platformRole;

  function current(id: string, entry?: Entry) {
    const accepted = entry?.basis;
    return accepted && canRead(id) && accepted.deadline > now() && sameBinding(accepted.binding, binding()) ? accepted : undefined;
  }

  function clearBasis(entry: Entry) {
    entry.basis = undefined;
    clearTimeout(entry.expiry);
    entry.expiry = undefined;
  }

  function cancel(entry: Entry) {
    const previous = entry.pending;
    entry.pending = undefined;
    previous?.controller.abort();
  }

  function expire(entry: Entry, accepted: NonNullable<Entry["basis"]>) {
    entry.expiry = setTimeout(() => {
      if (entry.basis !== accepted) return;
      if (accepted.deadline > now()) { expire(entry, accepted); return; }
      clearBasis(entry);
      cancel(entry);
      entry.status = "stale";
      changed();
    }, Math.max(0, Math.min(accepted.deadline - now(), 2_147_483_647)));
  }

  function retain(entry: Entry, pending: NonNullable<Entry["pending"]>, signal?: AbortSignal) {
    const listener = Symbol();
    pending.listeners.add(listener);
    const abort = () => {
      pending.listeners.delete(listener);
      if (entry.pending !== pending || pending.listeners.size) return;
      cancel(entry);
      if (entry.status === "loading") { entry.status = "not-loaded"; changed(); }
    };
    signal?.addEventListener("abort", abort, { once: true });
    return pending.promise.then(ready => ready && !signal?.aborted).finally(() => {
      signal?.removeEventListener("abort", abort);
      pending.listeners.delete(listener);
    });
  }

  function boundSource(id: string, value: SprintAssessmentSource, start: Binding) {
    return value?.sprintId === id && value.readAuthority?.userId === start.userId && Number.isFinite(value.readAuthority.deadline)
      && value.readAuthority.deadline > now() && value.readActor?.profileId === start.actor?.id
      && value.readActor?.platformRole === start.actor?.platformRole && typeof value.sourceRevision === "string" && Boolean(value.sourceRevision);
  }

  function usableRows(value: SprintAssessmentReceipt) {
    const counts = value.inputCounts;
    const inputKeys = ["people", "items", "commitments", "scores", "strikeStates", "objections", "meetings", "attendance"] as const;
    return typeof value.scoreLocked === "boolean" && counts && inputKeys.every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0)
      && Array.isArray(value.scoreRows) && counts.people === value.scoreRows.length
      && new Set(value.scoreRows.map(row => row?.profile?.id)).size === counts.people
      && value.scoreRows.every(row => row?.profile?.id && row.commitment?.profileId === row.profile.id
        && row.commitment.sprintId === value.sprintId && Number.isSafeInteger(row.commitment.id) && row.commitment.id >= 0
        && (row.commitment.id === 0 ? !row.commitment.updatedAt : Boolean(row.commitment.updatedAt))
        && Number.isFinite(row.v21Score?.totalPoints));
  }

  function begin(id: string, area: "content" | "source", options?: SprintAssessmentOptions): Promise<boolean> {
    const start = binding();
    if (!start.active || !start.sessionRevision || !start.actor || !canRead(id) || options?.signal?.aborted || !read) return Promise.resolve(false);
    const entry: Entry = entries.get(id) ?? { status: "not-loaded" };
    entries.set(id, entry);
    const existing = current(id, entry);
    if (area === "source" && (!observe || !existing)) return Promise.resolve(false);
    if (entry.pending && sameBinding(entry.pending.binding, start)
      && (entry.pending.area === area || area === "source")) return retain(entry, entry.pending, options?.signal);
    if (area === "content" && existing && !options?.refresh) return Promise.resolve(true);

    cancel(entry);
    if (area === "content" && !existing) { clearBasis(entry); entry.status = "loading"; }
    const started = nextSequence();
    const pending: NonNullable<Entry["pending"]> = {
      controller: new AbortController(), area, binding: start, listeners: new Set(),
      promise: Promise.resolve().then(async () => {
        const live = () => entry.pending === pending && !pending.controller.signal.aborted && canRead(id) && sameBinding(start, binding());
        const fail = (status: PlanningReadStatus) => { clearBasis(entry); entry.status = status; return false; };
        try {
          if (!live() || !pending.listeners.size) return false;
          const request = { signal: pending.controller.signal };
          if (area === "source") {
            const observed = await observe!(id, request);
            if (!live()) return false;
            if (!boundSource(id, observed, start)) return fail("unavailable");
            if (current(id, entry) !== existing || observed.sourceRevision !== existing?.receipt.sourceRevision) return fail("stale");
            return true;
          }
          const receipt = await read(id, request);
          if (!live()) return false;
          if (!boundSource(id, receipt, start) || !usableRows(receipt)) return fail("unavailable");
          const evaluated = Date.parse(receipt.evaluatedAt), validUntil = Date.parse(receipt.validUntil);
          const deadline = Math.min(receipt.readAuthority.deadline, validUntil, (start.sessionExpiresAt ?? 0) * 1000);
          if (!Number.isFinite(evaluated) || !Number.isFinite(deadline) || deadline <= now() || validUntil <= evaluated) return fail("stale");
          if (!acceptCommitments(receipt, started)) return fail("stale");
          clearBasis(entry);
          const basis = { receipt, binding: start, deadline };
          entry.basis = basis;
          entry.status = "current";
          expire(entry, basis);
          return true;
        } catch (error) {
          if (!live()) return false;
          const status = (error as { status?: number } | null)?.status;
          return fail(status === 401 || status === 403 ? "forbidden" : status === 409 || status === 404 ? "stale" : "unavailable");
        } finally {
          if (entry.pending === pending) {
            entry.pending = undefined;
            if (entry.status === "loading") entry.status = "stale";
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
    view(id: string): SprintAssessmentView {
      const entry = entries.get(id);
      if (!entry) return { readStatus: "not-loaded", scoreRows: null };
      const accepted = current(id, entry);
      return accepted
        ? { readStatus: "current", scoreRows: accepted.receipt.scoreRows, scoreLocked: accepted.receipt.scoreLocked }
        : { readStatus: entry.status === "current" ? "stale" : entry.status, scoreRows: null };
    },
    load: (id: string, options?: SprintAssessmentOptions) => begin(id, "content", options),
    check: (id: string, options?: SprintAssessmentOptions) => begin(id, "source", options),
    invalidate(id?: string) {
      for (const [sprintId, entry] of entries) {
        if (id && sprintId !== id) continue;
        cancel(entry); clearBasis(entry); entry.status = "stale";
      }
    },
    clear() {
      for (const entry of entries.values()) { cancel(entry); clearBasis(entry); }
      entries.clear();
    },
  };
}
