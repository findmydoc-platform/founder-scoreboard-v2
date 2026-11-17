import { normalizePlanningStructureQuery, type PlanningStructureModel, type PlanningStructureQuery, type PlanningStructureSelection } from "../planning-structure-query";
import type { PlanningReadStatus } from "../planning-state";

type Binding = { active: boolean; generation: number; sourceEpoch: number; sessionRevision?: string; userId: string; actor: { id: string; platformRole: string } | null };
export type StructureRead = { model: PlanningStructureModel; readAuthority: { userId: string; deadline: number }; readActor: { profileId: string; platformRole: string } };
type Pending = { key: string; controller: AbortController; consumers: Set<symbol>; result: Promise<boolean> };
type Entry = { status: PlanningReadStatus; selection?: PlanningStructureSelection; binding?: Binding; deadline?: number; pending?: Pending };
export function createPlanningStructureReads(ports: {
  read?: (query: PlanningStructureQuery, options: { signal: AbortSignal }) => Promise<StructureRead>;
  binding: () => Binding; now: () => number; publish: () => void;
  begin: () => number; accept: (read: StructureRead, started: number) => boolean;
}) {
  const entries = new Map<string, Entry>();
  const mounted = new Map<string, { query: PlanningStructureQuery; count: number; controller: AbortController }>();
  let acceptedSource: string | undefined, acceptedSequence = 0;
  const key = (query: PlanningStructureQuery) => JSON.stringify({ ...query, continuation: undefined });
  const scope = (query: PlanningStructureQuery) => query.area === "roots" ? "roots" : query.parentId;
  const same = (a: Binding, b: Binding) => b.active && a.generation === b.generation && a.sourceEpoch === b.sourceEpoch && a.sessionRevision === b.sessionRevision
    && a.userId === b.userId && a.actor?.id === b.actor?.id && a.actor?.platformRole === b.actor?.platformRole;
  function view(query: PlanningStructureQuery) {
    const entry = entries.get(scope(query));
    if (!entry || entry.selection && key(entry.selection.query) !== key(query)) return { readStatus: "not-loaded" as PlanningReadStatus, selection: undefined };
    if (entry.selection && (!entry.binding || !same(entry.binding, ports.binding()) || (entry.deadline || 0) <= ports.now())) entry.status = "stale";
    return { readStatus: entry.status, selection: entry.status === "current" ? entry.selection : undefined };
  }
  function clear() {
    for (const entry of entries.values()) entry.pending?.controller.abort();
    for (const value of mounted.values()) value.controller.abort(); mounted.clear();
    entries.clear(); acceptedSource = undefined; acceptedSequence = 0;
  }
  function load(input: PlanningStructureQuery, options: { signal?: AbortSignal; append?: boolean; refresh?: boolean } = {}): Promise<boolean> {
    const query = normalizePlanningStructureQuery(input), binding = ports.binding();
    if (!query || !binding.active || !binding.sessionRevision || !binding.actor || !ports.read || options.signal?.aborted) return Promise.resolve(false);
    const slot = scope(query);
    let entry = entries.get(slot);
    if (!entry) { entry = { status: "not-loaded" }; entries.set(slot, entry); }
    const value = entry, previous = options.append ? view(query).selection : undefined;
    if (options.append && (!previous || !query.continuation || previous.continuation !== query.continuation)) return Promise.resolve(false);
    if (!options.refresh && !options.append && view(query).selection && JSON.stringify(value.selection?.query) === JSON.stringify(query)) return Promise.resolve(true);
    const requestKey = JSON.stringify([query, Boolean(options.append)]);
    let pending = value.pending;
    if (!pending || pending.key !== requestKey || pending.controller.signal.aborted) {
      pending?.controller.abort();
      const controller = new AbortController(), consumers = new Set<symbol>(), started = ports.begin();
      if (!previous && !view(query).selection) value.status = "loading";
      const current = () => value.pending?.controller === controller && !controller.signal.aborted && same(binding, ports.binding());
      const result = ports.read(query, { signal: controller.signal }).then(read => {
        if (!current()) return false;
        const page = read.model?.structure, now = ports.now(), rows = read.model?.items;
        if (!page || !Array.isArray(rows) || JSON.stringify(normalizePlanningStructureQuery(page.query)) !== JSON.stringify(query)
          || read.readAuthority?.userId !== binding.userId || !Number.isFinite(read.readAuthority.deadline) || read.readAuthority.deadline <= now
          || read.readActor?.profileId !== binding.actor!.id || read.readActor.platformRole !== binding.actor!.platformRole
          || !page.sourceRevision || !page.scopeRevision || !Number.isFinite(Date.parse(page.observedAt)) || !Number.isFinite(Date.parse(page.validUntil)) || Date.parse(page.validUntil) <= now
          || !Array.isArray(page.itemIds) || !Array.isArray(page.contextIds) || !Number.isSafeInteger(page.total) || page.total < page.itemIds.length
          || new Set([...page.itemIds, ...page.contextIds]).size !== page.itemIds.length + page.contextIds.length
          || [...page.itemIds, ...page.contextIds].some(id => !rows.some(row => row.id === id))
          || !["complete", "partial"].includes(page.coverage)) { value.status = "unavailable"; ports.publish(); return false; }
        if (acceptedSource && acceptedSource !== page.sourceRevision) {
          if (started < acceptedSequence) { value.status = "stale"; ports.publish(); return false; }
          for (const other of entries.values()) if (other !== value) other.status = "stale";
        }
        let selection = page;
        if (previous) {
          const itemIds = [...previous.itemIds, ...page.itemIds];
          if (value.selection !== previous || previous.sourceRevision !== page.sourceRevision || previous.scopeRevision !== page.scopeRevision
            || previous.observedAt !== page.observedAt || previous.validUntil !== page.validUntil || previous.total !== page.total
            || (value.deadline || 0) <= now || new Set(itemIds).size !== itemIds.length || itemIds.length > page.total) {
            value.status = "stale"; ports.publish(); return false;
          }
          selection = { ...page, itemIds, contextIds: [...new Set([...previous.contextIds, ...page.contextIds])].filter(id => !itemIds.includes(id)) };
        }
        if (!ports.accept(read, started)) { value.status = "stale"; ports.publish(); return false; }
        acceptedSource = page.sourceRevision; acceptedSequence = Math.max(started, acceptedSequence);
        value.selection = selection; value.binding = binding; value.deadline = Math.min(previous ? value.deadline! : Infinity, read.readAuthority.deadline, Date.parse(page.validUntil));
        value.status = "current"; ports.publish(); return true;
      }).catch(error => {
        if (!current()) return false;
        const visible = mounted.get(key(query));
        if (query.continuation && error?.status === 409 && error?.code === "stale_continuation" && visible && !visible.controller.signal.aborted) {
          value.selection = undefined; value.status = "stale";
          return load({ ...query, continuation: undefined }, { refresh: true, signal: visible.controller.signal });
        }
        value.status = error?.status === 401 || error?.status === 403 ? "forbidden" : "unavailable";
        if (value.status === "forbidden") value.selection = undefined;
        ports.publish(); return false;
      }).finally(() => { if (value.pending?.controller === controller) value.pending = undefined; });
      pending = { key: requestKey, controller, consumers, result }; value.pending = pending; ports.publish();
    }
    const lease = pending, consumer = Symbol(); lease.consumers.add(consumer); let aborted = false;
    const release = () => { aborted = true; lease.consumers.delete(consumer); if (!lease.consumers.size && value.pending === lease) { lease.controller.abort(); value.pending = undefined; value.status = "stale"; ports.publish(); } };
    options.signal?.addEventListener("abort", release, { once: true });
    return lease.result.then(ok => !aborted && ok).finally(() => { options.signal?.removeEventListener("abort", release); lease.consumers.delete(consumer); });
  }
  function mount(query: PlanningStructureQuery) {
    const signature = key(query), current = mounted.get(signature) || { query: { ...query, continuation: undefined }, count: 0, controller: new AbortController() };
    current.count++; mounted.set(signature, current);
    return () => { if (--current.count === 0) { current.controller.abort(); if (mounted.get(signature) === current) mounted.delete(signature); } };
  }
  function refresh() { const visible = [...mounted.values()]; return Promise.all(visible.map(value => load(value.query, { refresh: true, signal: value.controller.signal }))).then(results => results.every(Boolean)); }
  return { view, load, clear, mount, refresh, mounted: () => mounted.size > 0 };

}
