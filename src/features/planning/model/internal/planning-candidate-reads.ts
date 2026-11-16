import { normalizeInitiativeCandidateQuery, type InitiativeCandidateQuery, type InitiativeCandidateReceipt, type InitiativeCandidateView, type PlanningCandidateAccess } from "@/features/planning-items/model/planning-item-candidates";

type Binding = { active: boolean; generation: number; sourceEpoch: number; sessionRevision?: string; userId: string; actor: { id: string; platformRole: string } | null };
type Pending = { controller: AbortController; consumers: Set<symbol>; result: Promise<{ ok: boolean }>; resolve: (value: { ok: boolean }) => void; timer?: ReturnType<typeof setTimeout>; previous: InitiativeCandidateView; binding: Binding; sequence: number };
type Entry = { view: InitiativeCandidateView; receipt?: InitiativeCandidateReceipt; acceptedBinding?: Binding; pending?: Pending; expiry?: ReturnType<typeof setTimeout> };

// Query receipts belong to the existing Planning owner. These scalar option
// fields never certify or replace canonical Task content or write authority.
export function createPlanningCandidateReads({ read, binding, publish, now }: {
  read?: (query: InitiativeCandidateQuery, options: { signal: AbortSignal }) => Promise<InitiativeCandidateReceipt>;
  binding: () => Binding; publish: () => void; now: () => number;
}): PlanningCandidateAccess & { invalidate(): void; clear(): void } {
  const entries = new Map<string, Entry>();
  const invalidView: InitiativeCandidateView = { query: { view: "candidates", kind: "initiative", query: "", limit: 20 }, readStatus: "unavailable", items: [], total: null, coverage: "unknown", continuation: null };
  let sequence = 0, acceptedSequence = 0, acceptedSource: string | undefined;
  const key = (query: InitiativeCandidateQuery) => JSON.stringify([query.kind, query.query, query.limit]);
  const sameSession = (a: Binding, b: Binding) => b.active && a.generation === b.generation && a.sessionRevision === b.sessionRevision && a.userId === b.userId
    && a.actor?.id === b.actor?.id && a.actor?.platformRole === b.actor?.platformRole;
  function entry(query: InitiativeCandidateQuery) {
    const normalized = normalizeInitiativeCandidateQuery(query)!;
    const signature = key(normalized);
    if (!entries.has(signature)) entries.set(signature, { view: { query: normalized, readStatus: "not-loaded", items: [], total: null, coverage: "unknown", continuation: null } });
    return entries.get(signature)!;
  }
  function valid(value: Entry) {
    const receipt = value.receipt;
    return Boolean(receipt && value.acceptedBinding && sameSession(value.acceptedBinding, binding())
      && receipt.readAuthority.deadline > now() && Date.parse(receipt.candidates.validUntil) > now());
  }
  function expire(value: Entry) {
    if (value.receipt && !valid(value)) {
      value.receipt = undefined;
      value.view = { ...value.view, readStatus: "stale", items: [], coverage: "unknown", total: null, continuation: null };
    }
  }
  function release(value: Entry) {
    const pending = value.pending;
    if (!pending) return;
    value.pending = undefined;
    clearTimeout(pending.timer); pending.controller.abort(); pending.resolve({ ok: false });
  }
  function clear() {
    for (const value of entries.values()) { release(value); clearTimeout(value.expiry); }
    entries.clear(); acceptedSource = undefined; acceptedSequence = 0;
  }
  function invalidate() {
    for (const value of entries.values()) {
      release(value);
      value.view = { ...value.view, readStatus: "stale", coverage: "unknown", continuation: null };
    }
    acceptedSource = undefined;
  }
  function retain(value: Entry, pending: Pending, signal?: AbortSignal) {
    const consumer = Symbol(); pending.consumers.add(consumer);
    let aborted = false;
    const abort = () => {
      aborted = true; pending.consumers.delete(consumer);
      if (!pending.consumers.size && value.pending === pending) {
        release(value); expire(value);
        value.view = valid(value) ? { ...value.view, readStatus: "stale" } : { ...pending.previous, readStatus: "not-loaded", items: [], coverage: "unknown", total: null, continuation: null };
        publish();
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    return pending.result.then(result => aborted ? { ok: false } : result).finally(() => { signal?.removeEventListener("abort", abort); pending.consumers.delete(consumer); });
  }
  async function execute(value: Entry, pending: Pending, query: InitiativeCandidateQuery) {
    if (value.pending !== pending || !pending.consumers.size) return;
    try {
      const receipt = await read!(query, { signal: pending.controller.signal });
      const current = binding();
      if (value.pending !== pending || pending.controller.signal.aborted) return;
      if (!sameSession(pending.binding, current) || pending.binding.sourceEpoch !== current.sourceEpoch) {
        value.receipt = undefined; value.view = { ...value.view, readStatus: "stale", items: [], total: null, coverage: "unknown", continuation: null }; return;
      }
      const page = receipt.candidates;
      if (!receipt.readAuthority || receipt.readAuthority.userId !== current.userId || !Number.isFinite(receipt.readAuthority.deadline) || receipt.readAuthority.deadline <= now()
        || !current.actor || receipt.readActor?.profileId !== current.actor.id || receipt.readActor.platformRole !== current.actor.platformRole
        || !page || typeof page.sourceRevision !== "string" || !page.sourceRevision || !Number.isFinite(Date.parse(page.observedAt)) || !Number.isFinite(Date.parse(page.validUntil)) || Date.parse(page.validUntil) <= now()
        || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < page.items.length || !["complete", "partial"].includes(page.coverage)) {
        value.view = { ...value.view, readStatus: "unavailable", items: [], coverage: "unknown", continuation: null }; value.receipt = undefined; return;
      }
      if (acceptedSource && acceptedSource !== page.sourceRevision) {
        if (pending.sequence < acceptedSequence) { value.view = { ...value.view, readStatus: "stale", coverage: "unknown", continuation: null }; return; }
        for (const other of entries.values()) if (other !== value) {
          release(other); other.view = { ...other.view, readStatus: "stale", coverage: "unknown", continuation: null };
        }
      }
      acceptedSource = page.sourceRevision; acceptedSequence = Math.max(acceptedSequence, pending.sequence);
      value.receipt = receipt;
      value.acceptedBinding = current;
      value.view = { query, readStatus: "current", items: page.items, total: page.total, coverage: page.coverage, continuation: page.continuation };
      clearTimeout(value.expiry);
      value.expiry = setTimeout(() => { expire(value); publish(); }, Math.max(0, Math.min(receipt.readAuthority.deadline, Date.parse(page.validUntil)) - now()));
    } catch (error) {
      const current = binding();
      if (sameSession(pending.binding, current) && typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403)) {
        clear(); entries.set(key(query), value); value.receipt = undefined;
        value.view = { ...value.view, readStatus: "forbidden", items: [], total: null, coverage: "unknown", continuation: null };
        publish();
      } else if (value.pending === pending) value.view = { ...value.view, readStatus: "unavailable", coverage: "unknown", continuation: null };
    } finally {
      if (value.pending === pending) { value.pending = undefined; pending.resolve({ ok: value.view.readStatus === "current" }); publish(); }
    }
  }
  return {
    clear, invalidate,
    candidates(query) { if (!normalizeInitiativeCandidateQuery(query)) return invalidView; if (!binding().active) clear(); const value = entry(query); expire(value); return value.view; },
    candidate(id) {
      if (!binding().active) return null;
      for (const value of entries.values()) {
        expire(value);
        if (value.view.readStatus === "current" && valid(value)) {
          const candidate = value.view.items.find(item => item.id === id);
          if (candidate) return candidate;
        }
      }
      return null;
    },
    loadCandidates(input, options) {
      const query = normalizeInitiativeCandidateQuery(input), current = binding();
      if (!query || !read || !current.active || options?.signal?.aborted) return Promise.resolve({ ok: false });
      const value = entry(query); expire(value);
      if (!options?.refresh && value.view.readStatus === "current" && valid(value)) return Promise.resolve({ ok: true });
      if (value.pending) {
        const pending = value.pending;
        if (options?.immediate && pending.timer) { clearTimeout(pending.timer); pending.timer = undefined; void execute(value, pending, query); }
        return retain(value, pending, options?.signal);
      }
      let resolve!: Pending["resolve"];
      const result = new Promise<{ ok: boolean }>(done => { resolve = done; });
      const pending: Pending = { controller: new AbortController(), consumers: new Set(), result, resolve, previous: value.view, binding: current, sequence: ++sequence };
      value.pending = pending; value.view = { ...value.view, query, readStatus: "loading" };
      const retained = retain(value, pending, options?.signal);
      if (options?.immediate) void execute(value, pending, query);
      else pending.timer = setTimeout(() => { pending.timer = undefined; void execute(value, pending, query); }, 250);
      publish();
      return retained;
    },
  };
}
