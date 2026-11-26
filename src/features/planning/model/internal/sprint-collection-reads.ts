import type { SprintScopedPage as SprintCollectionPage, SprintScopedQuery as SprintCollectionQuery, SprintScopedRead as SprintCollectionReceipt, SprintSelectedProjectionRead, SprintJointRead } from "@/features/sprint/model/sprint-scoped-read";
import type { PlanningReadStatus } from "../planning-state";
import type { Task } from "@/lib/types";

export type SprintCollectionView = { status: PlanningReadStatus; page?: SprintCollectionPage; moreStatus?: PlanningReadStatus };
type Binding = { active: boolean; generation: number; sourceEpoch: number; sessionRevision?: string; sessionExpiresAt?: number; userId: string; actor: { id: string; platformRole: string } | null };
type Entry = { signature: string; sequence: number; view: SprintCollectionView; controller?: AbortController; expiry?: ReturnType<typeof setTimeout>; receipt?: SprintCollectionReceipt; binding?: Binding; settled?: PromiseWithResolvers<void> };
type LoadOptions = {
  force?: boolean;
  onStart?: () => void;
  onAccept?: (receipt: SprintCollectionReceipt) => boolean;
  joint?: (signal: AbortSignal) => Promise<SprintJointRead>;
};
type SelectionBasis = { token: string; full: SprintCollectionReceipt; binding: Binding; members: Map<string, Task>; expiry?: ReturnType<typeof setTimeout> };

const absent: SprintCollectionView = { status: "not-loaded" };
export function sprintCollectionKey(query: SprintCollectionQuery) {
  const { query: text, status, assignee, risk, review, score, sort, direction } = query.filters;
  return JSON.stringify([query.scope, query.sprintId || "", text.trim().toLocaleLowerCase("de"), status, assignee, risk, review, score, sort, direction]);
}

export function createSprintCollectionReads({ read, readProjection, readJoint, binding, now, publish, onAccessDenied }: {
  read?: (query: SprintCollectionQuery, signal: AbortSignal) => Promise<SprintCollectionReceipt>;
  readProjection?: (query: SprintCollectionQuery, token: string, signal: AbortSignal) => Promise<SprintSelectedProjectionRead>;
  readJoint?: (query: SprintCollectionQuery, token: string, signal: AbortSignal) => Promise<SprintJointRead>;
  binding: () => Binding;
  now: () => number;
  publish: () => void;
  onAccessDenied?: () => void;
}) {
  const entries = new Map<SprintCollectionQuery["scope"], Entry>();
  let selectedMembership: Entry | undefined;
  let selectedBasis: SelectionBasis | undefined;
  let sequence = 0;
  const sameAuthority = (a: Binding, b: Binding) => b.active && a.generation === b.generation && a.sourceEpoch === b.sourceEpoch
    && a.sessionRevision === b.sessionRevision && a.sessionExpiresAt === b.sessionExpiresAt && a.userId === b.userId
    && a.actor?.id === b.actor?.id && a.actor?.platformRole === b.actor?.platformRole;
  function release(entry: Entry) {
    entry.controller?.abort();
    clearTimeout(entry.expiry);
    entry.settled?.resolve();
  }
  function clearBasis() {
    if (selectedBasis) clearTimeout(selectedBasis.expiry);
    selectedBasis = undefined;
  }
  function clear() {
    for (const entry of entries.values()) release(entry);
    entries.clear();
    selectedMembership = undefined;
    clearBasis();
  }
  function rejectAccess(query: SprintCollectionQuery, entry: Entry) {
    clear();
    entries.set(query.scope, entry);
    entry.view = { status: "forbidden" };
    onAccessDenied?.();
  }
  function view(query: SprintCollectionQuery): SprintCollectionView {
    const entry = entries.get(query.scope);
    if (!entry || entry.signature !== sprintCollectionKey(query) || !binding().active) return absent;
    if (entry.receipt && (!entry.binding || !sameAuthority(entry.binding, binding()) || deadline(entry.receipt) <= now())) return { status: "stale" };
    return entry.view;
  }
  function membership(sprintId?: string | null) {
    const entry = selectedMembership;
    if (!entry?.receipt || !entry.binding || !sameAuthority(entry.binding, binding()) || deadline(entry.receipt) <= now()) return undefined;
    return !sprintId || entry.receipt.page.sprintId === sprintId ? entry.receipt.page : undefined;
  }
  function cancel(query: SprintCollectionQuery) {
    const entry = entries.get(query.scope);
    if (!entry?.controller || entry.signature !== sprintCollectionKey(query)) return;
    release(entry);
    entries.delete(query.scope);
    publish();
  }
  function deadline(result: SprintCollectionReceipt) {
    return Math.min(result.readAuthority.deadline, Date.parse(result.page.validUntil));
  }
  function valid(result: SprintCollectionReceipt, query: SprintCollectionQuery, active: Binding) {
    const { page, readAuthority, readActor } = result;
    const evaluatedAt = Date.parse(page?.evaluatedAt || ""), validUntil = Date.parse(page?.validUntil || "");
    return Boolean(page && readAuthority && readActor && readAuthority.userId === active.userId && Number.isFinite(readAuthority.deadline)
      && readAuthority.deadline > now() && (!active.sessionExpiresAt || readAuthority.deadline <= active.sessionExpiresAt * 1_000)
      && readActor.profileId === active.actor?.id && readActor.platformRole === active.actor.platformRole
      && page.scope === query.scope && (!query.sprintId || page.sprintId === query.sprintId)
      && typeof page.sourceRevision === "string" && page.sourceRevision && Number.isFinite(evaluatedAt) && evaluatedAt <= now() && validUntil > now()
      && Array.isArray(page.items) && Array.isArray(page.context) && Number.isSafeInteger(page.scopeTotal)
      && Number.isSafeInteger(page.matchedTotal) && page.scopeTotal >= page.matchedTotal && page.matchedTotal >= page.items.length
      && new Set(page.items.map(item => item.id)).size === page.items.length
      && page.items.every(item => query.scope === "selected" ? Boolean(page.sprintId && item.sprintId === page.sprintId) : item.sprintId !== page.sprintId)
      && page.assignmentTargetsByItemId && Object.entries(page.assignmentTargetsByItemId).every(([id, targets]) =>
        page.items.some(item => item.id === id) && Array.isArray(targets) && targets.every(target => typeof target === "string" && target.length > 0)));
  }
  function arm(entry: Entry, query: SprintCollectionQuery) {
    const receipt = entry.receipt;
    if (!receipt || entry.expiry) return;
    entry.expiry = setTimeout(() => {
      if (entries.get(query.scope) !== entry) return;
      entry.receipt = undefined;
      entry.view = { status: "stale" };
      publish();
    }, Math.max(0, deadline(receipt) - now()));
  }
  function rememberBasis(receipt: SprintCollectionReceipt, active: Binding, rows: readonly Task[] | undefined) {
    clearBasis();
    if (!readProjection || !receipt.selectionBasis || !receipt.page.sprintId || rows?.length !== receipt.page.scopeTotal) return;
    const members = new Map(rows.map(task => [task.id, task]));
    if (members.size !== rows.length || rows.some(task => task.sprintId !== receipt.page.sprintId)
      || receipt.page.items.some(task => !members.has(task.id))) return;
    selectedBasis = { token: receipt.selectionBasis, full: receipt, binding: active, members };
  }
  function armBasis() {
    const basis = selectedBasis;
    if (!basis || basis.expiry) return;
    basis.expiry = setTimeout(() => {
      if (selectedBasis !== basis) return;
      clearBasis();
      publish();
    }, Math.max(0, deadline(basis.full) - now()));
  }
  function currentBasis(query: SprintCollectionQuery, active: Binding) {
    return selectedBasis && selectedBasis.full.page.sprintId === query.sprintId
      && sameAuthority(selectedBasis.binding, active) && deadline(selectedBasis.full) > now() ? selectedBasis : undefined;
  }
  function applyProjection(projected: SprintSelectedProjectionRead, base: SelectionBasis): SprintCollectionReceipt | undefined {
    const { full, members } = base;
    if (projected.projection !== "matches" || projected.sprintId !== full.page.sprintId
      || projected.sourceRevision !== full.page.sourceRevision || projected.scopeTotal !== full.page.scopeTotal
      || !Array.isArray(projected.matchedIds) || projected.matchedIds.length !== projected.matchedTotal
      || new Set(projected.matchedIds).size !== projected.matchedIds.length
      || projected.matchedIds.some(id => !members.has(id)) || projected.evaluatedAt !== full.page.evaluatedAt
      || projected.validUntil !== full.page.validUntil) return undefined;
    return {
      readActor: projected.readActor,
      readAuthority: { userId: projected.readAuthority.userId, deadline: Math.min(full.readAuthority.deadline, projected.readAuthority.deadline) },
      page: { ...full.page, items: projected.matchedIds.map(id => members.get(id)!), matchedTotal: projected.matchedTotal,
      },
    };
  }
  function seed(query: SprintCollectionQuery, receipt: SprintCollectionReceipt, members?: readonly Task[]) {
    const active = binding();
    if (!active.active || !valid(receipt, query, active) || query.continuation || receipt.page.continuation) return false;
    const previous = entries.get(query.scope);
    if (previous) release(previous);
    const entry: Entry = { signature: sprintCollectionKey(query), sequence: ++sequence, binding: active, receipt, view: { status: "current", page: receipt.page } };
    entries.set(query.scope, entry);
    if (query.scope === "selected") {
      selectedMembership = entry;
      rememberBasis(receipt, active, members);
    }
    return true;
  }
  async function load(query: SprintCollectionQuery, options?: LoadOptions) {
    const active = binding();
    if (!read || !active.active || !active.actor || (query.scope === "assignment" && !query.sprintId)) return false;
    if (query.scope === "selected") armBasis();
    const signature = sprintCollectionKey(query);
    const previous = entries.get(query.scope);
    const retained = previous?.signature === signature && previous.receipt && previous.binding
      && sameAuthority(previous.binding, active) && deadline(previous.receipt) > now() ? previous.receipt : undefined;
    if (previous?.signature === signature && previous.controller && !previous.controller.signal.aborted) return false;
    const base = query.continuation ? retained : undefined;
    if (query.continuation && base?.page.continuation !== query.continuation) return false;
    if (retained && !query.continuation && previous?.view.status === "current" && !options?.force) {
      arm(previous, query);
      return true;
    }
    if (previous) release(previous);
    const controller = new AbortController();
    const settled = Promise.withResolvers<void>();
    const entry: Entry = { signature, sequence: ++sequence, controller, settled, binding: active, view: base ? { status: "current", page: base.page, moreStatus: "loading" } : { status: "loading" } };
    entries.set(query.scope, entry);
    const applies = () => entries.get(query.scope) === entry && !controller.signal.aborted && sameAuthority(active, binding());
    publish();
    try {
      const selection = query.scope === "selected" && !options?.force ? currentBasis(query, active) : undefined;
      let incoming: SprintCollectionReceipt | undefined;
      if (readProjection && selection) {
        try {
          const projected = options?.joint
            ? await readJointProjection(options.joint, controller.signal, () => readProjection(query, selection.token, controller.signal), applies)
            : await readProjection(query, selection.token, controller.signal);
          if (!applies()) return false;
          if (projected.readActor && (projected.readActor.profileId !== active.actor.id || projected.readActor.platformRole !== active.actor.platformRole)) {
            rejectAccess(query, entry);
            return false;
          }
          if (currentBasis(query, active) === selection) {
            if (projected.readAuthority?.userId !== active.userId || !Number.isFinite(projected.readAuthority.deadline)
              || projected.readAuthority.deadline <= now() || active.sessionExpiresAt && projected.readAuthority.deadline > active.sessionExpiresAt * 1_000) {
              entry.view = { status: "unavailable" }; return false;
            }
            incoming = applyProjection(projected, selection);
            if (!incoming) { entry.view = { status: "unavailable" }; return false; }
          }
        } catch (error) {
          if (!(typeof error === "object" && error !== null && "status" in error && error.status === 409
            && "code" in error && error.code === "stale_selection_basis")) throw error;
          if (!applies()) return false;
          if (selectedBasis === selection) clearBasis();
          if (selectedMembership?.receipt?.page.sourceRevision === selection.full.page.sourceRevision) selectedMembership = undefined;
          publish();
        }
      }
      const projected = Boolean(incoming);
      if (!incoming) {
        if (query.scope === "selected" && !options?.force) {
          const candidate = entries.get("assignment");
          if (candidate?.signature === sprintCollectionKey({ ...query, scope: "assignment" })
            && candidate.controller && !candidate.controller.signal.aborted && candidate.settled
            && candidate.binding && sameAuthority(candidate.binding, active)) {
            await Promise.race([candidate.settled.promise, settled.promise]);
          }
        }
        if (!applies()) return false;
        options?.onStart?.();
        incoming = query.scope === "assignment" && options?.joint
          ? await options.joint(controller.signal) : await read(query, controller.signal);
      }
      if (!applies()) return false;
      if (incoming.readActor && (incoming.readActor.profileId !== active.actor.id || incoming.readActor.platformRole !== active.actor.platformRole)) {
        rejectAccess(query, entry);
        return false;
      }
      if (!valid(incoming, query, active)) { entry.view = { status: "unavailable" }; return false; }
      const next = incoming.page;
      const previousIds = new Set(base?.page.items.map(item => item.id));
      if (base && (next.sourceRevision !== base.page.sourceRevision || next.evaluatedAt !== base.page.evaluatedAt || next.validUntil !== base.page.validUntil
        || next.matchedTotal !== base.page.matchedTotal || next.scopeTotal !== base.page.scopeTotal || next.items.some(item => previousIds.has(item.id)))) {
        entry.view = { status: "stale" }; return false;
      }
      const page = { ...next, items: base ? [...base.page.items, ...next.items] : next.items,
        assignmentTargetsByItemId: { ...base?.page.assignmentTargetsByItemId, ...next.assignmentTargetsByItemId },
        context: base ? [...new Map([...base.page.context, ...next.context].map(item => [item.id, item])).values()] : next.context };
      if (page.items.length > page.matchedTotal || (page.continuation ? page.items.length >= page.matchedTotal || page.continuation === query.continuation : page.items.length !== page.matchedTotal)) {
        entry.view = { status: "unavailable" }; return false;
      }
      const receipt = { ...incoming, page, readAuthority: { ...incoming.readAuthority, deadline: Math.min(incoming.readAuthority.deadline, base?.readAuthority.deadline ?? Infinity) } };
      const peer = entries.get(query.scope === "selected" ? "assignment" : "selected");
      if (peer?.receipt && peer.receipt.page.sourceRevision !== page.sourceRevision) {
        if (peer.sequence > entry.sequence) { entry.view = { status: "stale" }; return false; }
        release(peer);
        peer.receipt = undefined;
        peer.view = { status: "stale" };
      }
      if (selectedMembership?.receipt && selectedMembership.receipt.page.sourceRevision !== page.sourceRevision) selectedMembership = undefined;
      if (selectedBasis && selectedBasis.full.page.sourceRevision !== page.sourceRevision) clearBasis();
      if (!projected && options?.onAccept && !options.onAccept(receipt)) { entry.view = { status: "unavailable" }; return false; }
      entry.receipt = receipt;
      entry.view = { status: "current", page, moreStatus: base ? "current" : undefined };
      if (query.scope === "selected") {
        selectedMembership = entry;
        if (!projected) {
          rememberBasis(receipt, active, receipt.model?.items);
          armBasis();
        }
      }
      arm(entry, query);
      return true;
    } catch (error) {
      if (!applies()) return false;
      const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
      if (status === 401 || status === 403) rejectAccess(query, entry);
      else if (status === 409) entry.view = { status: "stale" };
      else if (base && deadline(base) > now()) { entry.receipt = base; entry.view = { status: "current", page: base.page, moreStatus: "unavailable" }; arm(entry, query); }
      else entry.view = { status: "unavailable" };
      return false;
    } finally {
      settled.resolve();
      if (entries.get(query.scope) === entry) {
        if (!sameAuthority(active, binding()) && entry.view.status === "loading") entry.view = { status: "stale" };
        entry.controller = undefined;
        publish();
      }
    }
  }
  function existingDemand(query: SprintCollectionQuery, active: Binding) {
    const entry = entries.get(query.scope);
    return Boolean(entry?.signature === sprintCollectionKey(query) && entry.binding && sameAuthority(entry.binding, active)
      && (entry.controller && !entry.controller.signal.aborted
        || entry.receipt && entry.view.status === "current" && deadline(entry.receipt) > now()));
  }
  async function loadShared(query: SprintCollectionQuery, options?: Omit<LoadOptions, "joint">) {
    if (query.scope !== "selected" || query.continuation) return false;
    const active = binding();
    const assignment: SprintCollectionQuery = { ...query, scope: "assignment" };
    const selection = currentBasis(query, active);
    if (!readJoint || !readProjection || !selection || !query.sprintId || options?.force
      || existingDemand(query, active) || existingDemand(assignment, active)) {
      const results = await Promise.all([load(assignment), load(query, options)]);
      return results.every(Boolean);
    }
    const jointRead = readJoint;
    const { token } = selection;
    const controller = new AbortController();
    const consumers = new Set<AbortSignal>();
    let response: Promise<SprintJointRead> | undefined;
    function join(signal: AbortSignal) {
      consumers.add(signal);
      const cancel = () => {
        consumers.delete(signal);
        if (!consumers.size) controller.abort();
      };
      signal.addEventListener("abort", cancel, { once: true });
      response ??= Promise.resolve().then(() => jointRead(assignment, token, controller.signal));
      return response.finally(() => {
        signal.removeEventListener("abort", cancel);
        consumers.delete(signal);
      });
    }
    const results = await Promise.all([load(assignment, { joint: join }), load(query, { ...options, joint: join })]);
    return results.every(Boolean);
  }
  return { view, seed, load, loadShared, clear, cancel, membership };
}

async function readJointProjection(
  readJoint: (signal: AbortSignal) => Promise<SprintJointRead>, signal: AbortSignal,
  standalone: () => Promise<SprintSelectedProjectionRead>, applies: () => boolean,
) {
  let response: SprintJointRead;
  try {
    response = await readJoint(signal);
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
    if (status === 401 || status === 403 || !applies()) throw error;
    return standalone();
  }
  if (response.selected?.status === "ready") {
    const selected = response.selected.read;
    const candidates = response.page;
    if (candidates?.scope !== "assignment" || selected.sprintId !== candidates.sprintId
      || selected.sourceRevision !== candidates.sourceRevision || selected.evaluatedAt !== candidates.evaluatedAt
      || selected.validUntil !== candidates.validUntil || selected.readAuthority.userId !== response.readAuthority.userId
      || selected.readAuthority.deadline > response.readAuthority.deadline
      || selected.readActor.profileId !== response.readActor.profileId || selected.readActor.platformRole !== response.readActor.platformRole) {
      throw new Error("Sprint search receipts do not share a valid basis");
    }
    return selected;
  }
  if (response.selected?.status === "staleSelectionBasis") throw { status: 409, code: "stale_selection_basis" };
  throw new Error("Sprint selection projection unavailable");
}
