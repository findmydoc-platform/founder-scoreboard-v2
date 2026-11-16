import { normalizePlanningItemCandidateQuery, type PlanningItemCandidateQuery, type PlanningItemCandidateReceipt, type PlanningItemCandidateView, type PlanningCandidateAccess, type PlanningCandidateDefault } from "@/features/planning-items/model/planning-item-candidates";

type Binding = { active: boolean; generation: number; sourceEpoch: number; sessionRevision?: string; userId: string; actor: { id: string; platformRole: string } | null };
type Pending = { controller: AbortController; consumers: Set<symbol>; result: Promise<{ ok: boolean }>; resolve: (value: { ok: boolean }) => void; timer?: ReturnType<typeof setTimeout>; previous: PlanningItemCandidateView; binding: Binding; sequence: number; append: boolean; base?: PlanningItemCandidateReceipt };
type Entry = { view: PlanningItemCandidateView; receipt?: PlanningItemCandidateReceipt; acceptedBinding?: Binding; pending?: Pending; expiry?: ReturnType<typeof setTimeout>; consumed?: Set<string> };

// Query receipts belong to the existing Planning owner. These scalar option
// fields never certify or replace canonical Task content or write authority.
export function createPlanningCandidateReads({ read, binding, publish, now }: {
  read?: (query: PlanningItemCandidateQuery, options: { signal: AbortSignal }) => Promise<PlanningItemCandidateReceipt>;
  binding: () => Binding; publish: () => void; now: () => number;
}): PlanningCandidateAccess & { invalidate(): void; clear(): void; deny(): void } {
  const entries = new Map<string, Entry>();
  const invalidView: PlanningItemCandidateView = { query: { view: "candidates", kind: "initiative", query: "", limit: 20 }, readStatus: "unavailable", furtherReadStatus: "not-loaded", items: [], total: null, coverage: "unknown", continuation: null, defaultChoice: { status: "not-applicable" } };
  let sequence = 0, acceptedSequence = 0, acceptedSource: string | undefined;
  const key = (query: PlanningItemCandidateQuery) => JSON.stringify([query.kind, query.query, query.limit]);
  const unknownDefault = (query: PlanningItemCandidateQuery): PlanningCandidateDefault => ({ status: query.kind === "epic" ? "unknown" : "not-applicable" });
  const sameSession = (a: Binding, b: Binding) => b.active && a.generation === b.generation && a.sessionRevision === b.sessionRevision && a.userId === b.userId
    && a.actor?.id === b.actor?.id && a.actor?.platformRole === b.actor?.platformRole;
  function entry(query: PlanningItemCandidateQuery) {
    const normalized = normalizePlanningItemCandidateQuery(query)!;
    const signature = key(normalized);
    if (!entries.has(signature)) entries.set(signature, { view: { query: normalized, readStatus: "not-loaded", furtherReadStatus: "not-loaded", items: [], total: null, coverage: "unknown", continuation: null, defaultChoice: unknownDefault(normalized) } });
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
      value.view = { ...value.view, readStatus: "stale", items: [], coverage: "unknown", total: null, continuation: null, defaultChoice: unknownDefault(value.view.query) };
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
      value.view = { ...value.view, readStatus: "stale", coverage: "unknown", continuation: null, defaultChoice: unknownDefault(value.view.query) };
    }
    acceptedSource = undefined;
  }
  function deny() {
    // An item-level denial cannot establish which unloaded matches contributed
    // to a query's exact count. Invalidate this candidate contract, not the
    // independent canonical Task store or other workspace contracts.
    for (const value of entries.values()) {
      release(value); clearTimeout(value.expiry);
      value.receipt = undefined; value.acceptedBinding = undefined; value.consumed = undefined;
      value.view = { ...value.view, readStatus: "stale", furtherReadStatus: "stale", items: [], total: null, coverage: "unknown", continuation: null, defaultChoice: unknownDefault(value.view.query) };
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
        value.view = valid(value) ? pending.append ? pending.previous : { ...value.view, readStatus: "stale" } : { ...pending.previous, readStatus: "not-loaded", items: [], coverage: "unknown", total: null, continuation: null };
        publish();
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    return pending.result.then(result => aborted ? { ok: false } : result).finally(() => { signal?.removeEventListener("abort", abort); pending.consumers.delete(consumer); });
  }
  async function execute(value: Entry, pending: Pending, query: PlanningItemCandidateQuery) {
    if (value.pending !== pending || !pending.consumers.size) return;
    try {
      const receipt = await read!(query, { signal: pending.controller.signal });
      const current = binding();
      if (value.pending !== pending || pending.controller.signal.aborted) return;
      if (!sameSession(pending.binding, current) || pending.binding.sourceEpoch !== current.sourceEpoch) {
        value.receipt = undefined; value.view = { ...value.view, readStatus: "stale", items: [], total: null, coverage: "unknown", continuation: null, defaultChoice: unknownDefault(query) }; return;
      }
      const page = receipt.candidates;
      if (!receipt.readAuthority || receipt.readAuthority.userId !== current.userId || !Number.isFinite(receipt.readAuthority.deadline) || receipt.readAuthority.deadline <= now()
        || !current.actor || receipt.readActor?.profileId !== current.actor.id || receipt.readActor.platformRole !== current.actor.platformRole
        || !page || typeof page.sourceRevision !== "string" || !page.sourceRevision || !Number.isFinite(Date.parse(page.observedAt)) || !Number.isFinite(Date.parse(page.validUntil)) || Date.parse(page.validUntil) <= now()
        || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < page.items.length || !["complete", "partial"].includes(page.coverage)
        || page.items.some(item => item.taskType !== query.kind || item.taskType === "deliverable" && typeof item.parentTitle !== "string" && item.parentTitle !== null)
        || query.kind !== "epic" && page.kind === "epic"
        || query.kind === "epic" && (page.kind !== "epic" || page.defaultCandidate !== null && (page.defaultCandidate.taskType !== "epic" || !page.defaultCandidate.id || typeof page.defaultCandidate.title !== "string"))) {
        value.view = { ...value.view, readStatus: "unavailable", items: [], coverage: "unknown", continuation: null, defaultChoice: unknownDefault(query) }; value.receipt = undefined; return;
      }
      if (acceptedSource && acceptedSource !== page.sourceRevision) {
        if (pending.sequence < acceptedSequence) { value.view = { ...value.view, readStatus: "stale", coverage: "unknown", continuation: null }; return; }
        for (const other of entries.values()) if (other !== value) {
          release(other); other.view = { ...other.view, readStatus: "stale", coverage: "unknown", continuation: null };
        }
      }
      const base = pending.base;
      const previousIds = new Set(base?.candidates.items.map(item => item.id));
      if (pending.append && (!base || page.sourceRevision !== base.candidates.sourceRevision || page.observedAt !== base.candidates.observedAt
        || page.validUntil !== base.candidates.validUntil || page.total !== base.candidates.total
        || base.readAuthority.deadline <= now() || page.items.some(item => previousIds.has(item.id)))) {
        value.view = { ...value.view, readStatus: "stale", coverage: "unknown", continuation: null, furtherReadStatus: "stale" }; return;
      }
      const items = pending.append ? [...base!.candidates.items, ...page.items] : page.items;
      if (items.length > page.total || page.coverage === "complete" && items.length !== page.total
        || page.coverage === "partial" && (items.length >= page.total || !page.continuation)) {
        value.view = { ...value.view, readStatus: "stale", coverage: "unknown", continuation: null, furtherReadStatus: "stale" }; return;
      }
      const accepted = { ...receipt, candidates: { ...page, items }, readAuthority: { ...receipt.readAuthority,
        deadline: Math.min(receipt.readAuthority.deadline, pending.append ? base!.readAuthority.deadline : Infinity) } };
      acceptedSource = page.sourceRevision; acceptedSequence = Math.max(acceptedSequence, pending.sequence);
      value.receipt = accepted;
      value.acceptedBinding = current;
      if (!pending.append) value.consumed = new Set();
      if (query.continuation) value.consumed?.add(query.continuation);
      const baseQuery = { ...query, continuation: undefined };
      value.view = { query: baseQuery, readStatus: "current", furtherReadStatus: pending.append ? "current" : "not-loaded", items, total: page.total, coverage: page.coverage, continuation: page.continuation,
        defaultChoice: page.kind === "epic" ? { status: "current", item: page.defaultCandidate } : { status: "not-applicable" } };
      clearTimeout(value.expiry);
      value.expiry = setTimeout(() => { expire(value); publish(); }, Math.max(0, Math.min(accepted.readAuthority.deadline, Date.parse(page.validUntil)) - now()));
    } catch (error) {
      const current = binding();
      if (sameSession(pending.binding, current) && typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403)) {
        clear(); entries.set(key(query), value); value.receipt = undefined;
        value.view = { ...value.view, readStatus: "forbidden", items: [], total: null, coverage: "unknown", continuation: null, defaultChoice: unknownDefault(query) };
        publish();
      } else if (value.pending === pending) {
        if (pending.append && valid(value) && typeof error === "object" && error !== null && "status" in error && error.status !== 409) {
          value.view = { ...pending.previous, furtherReadStatus: "unavailable" };
        } else value.view = { ...value.view, readStatus: "unavailable", furtherReadStatus: "unavailable", coverage: "unknown", continuation: null };
      }
    } finally {
      if (value.pending === pending) { value.pending = undefined; pending.resolve({ ok: value.view.readStatus === "current" && value.view.furtherReadStatus !== "unavailable" }); publish(); }
    }
  }
  return {
    clear, invalidate, deny,
    candidates(query) { if (!normalizePlanningItemCandidateQuery(query)) return invalidView; if (!binding().active) clear(); const value = entry(query); expire(value); return value.view; },
    candidate(id) {
      if (!binding().active) return null;
      for (const value of entries.values()) {
        expire(value);
        if (value.view.readStatus === "current" && valid(value)) {
          const candidate = value.view.items.find(item => item.id === id);
          if (candidate) return candidate;
          if (value.view.defaultChoice.status === "current" && value.view.defaultChoice.item?.id === id) return value.view.defaultChoice.item;
        }
      }
      return null;
    },
    loadCandidates(input, options) {
      const normalized = normalizePlanningItemCandidateQuery(input);
      const current = binding();
      if (!normalized || !read || !current.active || options?.signal?.aborted) return Promise.resolve({ ok: false });
      const value = entry(normalized); expire(value);
      const fresh = value.view.readStatus === "current" && valid(value);
      if (normalized.continuation && fresh && value.consumed?.has(normalized.continuation)) return Promise.resolve({ ok: true });
      const append = Boolean(normalized.continuation && fresh && value.view.continuation === normalized.continuation);
      const restart = Boolean(normalized.continuation && !append);
      const query = restart ? { ...normalized, continuation: undefined } : normalized;
      if (!append && !restart && !options?.refresh && fresh) return Promise.resolve({ ok: true });
      if (value.pending) {
        const pending = value.pending;
        if (pending.append !== append || append && pending.base?.candidates.continuation !== query.continuation) return Promise.resolve({ ok: false });
        if (options?.immediate && pending.timer) { clearTimeout(pending.timer); pending.timer = undefined; void execute(value, pending, query); }
        return retain(value, pending, options?.signal);
      }
      let resolve!: Pending["resolve"];
      const result = new Promise<{ ok: boolean }>(done => { resolve = done; });
      const pending: Pending = { controller: new AbortController(), consumers: new Set(), result, resolve, previous: value.view, binding: current, sequence: ++sequence, append, base: append ? value.receipt : undefined };
      value.pending = pending; value.view = append ? { ...value.view, furtherReadStatus: "loading" } : { ...value.view, query, readStatus: "loading", furtherReadStatus: "not-loaded" };
      const retained = retain(value, pending, options?.signal);
      if (options?.immediate) void execute(value, pending, query);
      else pending.timer = setTimeout(() => { pending.timer = undefined; void execute(value, pending, query); }, 250);
      publish();
      return retained;
    },
  };
}
