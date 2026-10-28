import type { FounderEvent, PlanningHeaderData, PlanningShellState } from "@/lib/types";
import type { PlanningReadStatus } from "../planning-state";
import type { EventConfirmation, EventCoverage, EventOperation, EventRange, EventRead, EventResult, EventsAdapter, FounderEventDraft, PlanningEventsState } from "@/features/events/model/event-state";

function contains(range: EventRange | null, event: FounderEvent) { return !range || (event.startsAt >= range.from && event.startsAt < range.to); }
function normalize(draft: FounderEventDraft): FounderEventDraft {
  const start = new Date(draft.startsAt), end = draft.endsAt ? new Date(draft.endsAt) : null;
  if (!draft.startsAt || Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime()))) throw new Error("Event-Zeit ist ungültig. Bitte Datum und Uhrzeit vollständig auswählen.");
  if (end && end < start) throw new Error("Die Endzeit darf nicht vor der Startzeit liegen.");
  return { ...structuredClone(draft), title: draft.title.trim(), location: draft.location.trim(), description: draft.description.trim(), startsAt: start.toISOString(), endsAt: end?.toISOString() || "", participantProfileIds: draft.audienceMode === "selected" ? [...draft.participantProfileIds] : [] };
}
export function createEventsState(options: { initial: readonly FounderEvent[]; loaded: boolean; adapter: EventsAdapter; active: () => boolean; generation: () => number; changed: () => void; invalidateCalendar: () => void; refreshWorkspace: () => Promise<boolean>; endSession: () => void; beginHeaderRead: () => number; acceptHeaderRead: (data: PlanningHeaderData, started: number) => void }) {
  let records = [...options.initial], readStatus: PlanningReadStatus = options.loaded ? "current" : "not-loaded", coverage: EventCoverage | null = options.loaded ? { range: null, completeness: "partial" } : null;
  let sequence = 0, mutationBoundary = 0, localId = -1, denied = false, denialAt = 0, authorityGeneration = 0;
  const receipts = new Map<number, { started: number; acceptedAt: number; readThrough: number; basisVersion: string | undefined }>();
  const accepted = new Map<number, number>(), barriers: { range: EventRange | null; at: number }[] = [], operations = new Map<string, EventOperation>();
  const reads = new Map<string, { started: number; promise: Promise<boolean> }>();
  function visible() {
    if (denied || !options.active()) return [];
    const result = [...records];
    for (const operation of operations.values()) if (operation.phase === "saving" || operation.phase === "unconfirmed") {
      const index = result.findIndex(event => event.id === operation.eventId);
      const original = result[index];
      const event = { ...(original || { id: operation.eventId, createdBy: "", createdAt: "", updatedAt: "", reminderGeneratedAt: "" }), ...operation.draft, id: operation.eventId } as FounderEvent;
      if (index >= 0) result[index] = event; else result.push(event);
    }
    return result;
  }
  function beginRead() { readStatus = "loading"; return ++sequence; }
  function calendarIdentity(events: readonly FounderEvent[]) {
    return JSON.stringify(events.map(({ id, title, category, startsAt, endsAt, location, status }) => ({ id, title, category, startsAt, endsAt: endsAt || startsAt, location, status })).sort((a, b) => a.id - b.id));
  }
  function calendarChanged(before: FounderEvent | undefined, after: FounderEvent) { return !before || calendarIdentity([before]) !== calendarIdentity([after]); }
  function acceptRead(result: EventRead, started: number, includesHeader = false) {
    if (started < denialAt) return false;
    const previousCalendar = calendarIdentity(records);
    let stale = false;
    denied = false;
    const protectedEvent = (event: FounderEvent, incoming = false) => {
      const own = receipts.get(event.id);
      // An overlapping read can observe a foreign successor, but the displayed predecessor is not newer evidence.
      const successor = incoming && own && own.acceptedAt === accepted.get(event.id) && started >= own.readThrough && started > own.started && event.updatedAt !== own.basisVersion;
      return ((accepted.get(event.id) || 0) > started && !successor) || barriers.some(barrier => barrier.at > started && contains(barrier.range, event));
    };
    const incoming = new Map(result.events.filter(event => { if (protectedEvent(event, true)) { stale = true; return false; } return true; }).map(event => [event.id, event]));
    records = records.filter(event => {
      if (incoming.has(event.id)) return false;
      if (result.coverage.completeness !== "complete" || !contains(result.coverage.range, event)) return true;
      if (protectedEvent(event)) { stale = true; return true; }
      accepted.set(event.id, started); return false;
    });
    for (const event of incoming.values()) { records.push(event); accepted.set(event.id, started); receipts.delete(event.id); }
    const existing = barriers.findIndex(barrier => JSON.stringify(barrier.range) === JSON.stringify(result.coverage.range));
    if (existing >= 0) barriers[existing].at = Math.max(barriers[existing].at, started);
    else barriers.push({ range: result.coverage.range, at: started });
    coverage = result.coverage; readStatus = stale ? "stale" : "current";
    if (!includesHeader && previousCalendar !== calendarIdentity(records)) options.invalidateCalendar();
    return true;
  }
  function failed(error: unknown, started = sequence) {
    if (started < denialAt || barriers.some(barrier => barrier.at > started)) return;
    const status = (error as { status?: number })?.status;
    readStatus = status === 401 || status === 403 ? "forbidden" : "unavailable";
    if (readStatus === "forbidden") { denied = true; denialAt = ++sequence; authorityGeneration++; records = []; coverage = null; operations.clear(); }
  }
  async function refresh(range: EventRange | null = null): Promise<boolean> {
    if (!options.active()) return false;
    if (!options.adapter.readEvents) return options.refreshWorkspace();
    if (range) {
      const from = new Date(range.from), to = new Date(range.to);
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) return false;
      range = { from: from.toISOString(), to: to.toISOString() };
    }
    const key = JSON.stringify(range), existingRead = reads.get(key);
    if (existingRead && existingRead.started >= mutationBoundary) return existingRead.promise;
    const generation = options.generation(), started = beginRead(), headerRead = options.beginHeaderRead(); options.changed();
    const promise = (async () => {
      try {
        const result = await options.adapter.readEvents!(range);
        if (!options.active() || generation !== options.generation()) return false;
        if (JSON.stringify(result.coverage.range) !== key) throw new Error("Die Event-Antwort gehört zu einem anderen Zeitraum.");
        const hasCalendar = result.headerData?.calendarEvents.state === "ready" && result.headerData.calendarEvents.freshness !== "stale";
        const acceptedRead = acceptRead(result, started, hasCalendar);
        if (!acceptedRead) return false;
        if (result.headerData) options.acceptHeaderRead(result.headerData, headerRead);
        options.changed(); return true;
      } catch (error) { if (options.active() && generation === options.generation()) { failed(error, started); options.changed(); } return false; }
    })();
    reads.set(key, { started, promise }); void promise.finally(() => { if (reads.get(key)?.promise === promise) reads.delete(key); }); return promise;
  }
  async function save(id: string, draft: FounderEventDraft, basis?: FounderEvent): Promise<EventResult> {
    if (!options.active()) return { phase: "session-ended", error: "Die Sitzung wurde ersetzt." };
    if (denied) return { phase: "rejected", error: "Events sind in dieser Sitzung nicht verfügbar. Lade zuerst den aktuellen Stand." };
    const predecessor = operations.get(id) || [...operations.values()].find(operation => basis && operation.eventId === basis.id && (operation.phase === "unconfirmed" || operation.phase === "saving"));
    if (predecessor && ["saving", "saved", "unconfirmed"].includes(predecessor.phase)) return { phase: predecessor.phase === "saved" ? "saved" : "unconfirmed", error: predecessor.error, warning: predecessor.warning };
    let normalized: FounderEventDraft;
    try { normalized = normalize(draft); } catch (error) { return { phase: "rejected", error: (error as Error).message }; }
    const writer = basis ? options.adapter.updateEvent && (() => options.adapter.updateEvent!(basis, normalized)) : options.adapter.createEvent && (() => options.adapter.createEvent!(normalized));
    if (!writer) return { phase: "rejected", error: "Event-Speicherung ist nicht verfügbar." };
    const current = basis && records.find(event => event.id === basis.id);
    if (basis && current && basis.updatedAt !== current.updatedAt) {
      operations.set(id, { id, eventId: basis.id, draft: normalized, phase: "conflict", error: "Event wurde zwischenzeitlich geändert. Bitte den aktuellen Stand prüfen.", checking: false }); options.changed(); return { phase: "conflict", error: operations.get(id)!.error };
    }
    const operation: EventOperation = { id, eventId: basis?.id ?? localId--, draft: normalized, phase: "saving", error: "", checking: false };
    operations.set(id, operation); const generation = options.generation(), authority = authorityGeneration, started = ++sequence; mutationBoundary = started; options.changed();
    try {
      const result: EventConfirmation = await writer();
      if (!options.active() || generation !== options.generation() || authority !== authorityGeneration) return { phase: "session-ended" };
      if (!result.event.updatedAt || !Number.isFinite(result.event.id) || result.event.id <= 0 || (basis && result.event.id !== basis.id)) throw new Error("Ob das Event gespeichert wurde, ist noch unklar.");
      const latest = records.find(event => event.id === result.event.id);
      const protectedResult = (accepted.get(result.event.id) || 0) > started || barriers.some(barrier => barrier.at > started && contains(barrier.range, result.event));
      if (protectedResult && latest?.updatedAt !== result.event.updatedAt && (basis ? latest?.updatedAt !== basis.updatedAt : Boolean(latest))) readStatus = "stale";
      else { const readThrough = accepted.get(result.event.id) || 0, acceptedAt = ++sequence; records = [...records.filter(event => event.id !== result.event.id), result.event]; accepted.set(result.event.id, acceptedAt); receipts.set(result.event.id, { started, acceptedAt, readThrough, basisVersion: basis?.updatedAt }); }
      mutationBoundary = ++sequence;
      operation.eventId = result.event.id; operation.phase = "saved"; operation.warning = result.warning;
      if (calendarChanged(basis, result.event)) options.invalidateCalendar();
      options.changed(); return { phase: "saved", warning: result.warning };
    } catch (error) {
      if (!options.active() || generation !== options.generation() || authority !== authorityGeneration) return { phase: "session-ended" };
      const failure = error as { status?: number; code?: string; message?: string };
      if (failure.code === "session_superseded") { options.endSession(); return { phase: "session-ended", error: "Die Sitzung wurde ersetzt." }; }
      operation.phase = failure.code === "event_version_conflict" ? "conflict" : failure.status && failure.status < 500 ? "rejected" : "unconfirmed";
      operation.error = failure.message || "Ob das Event gespeichert wurde, ist noch unklar.";
      if (operation.phase === "unconfirmed") { mutationBoundary = ++sequence; readStatus = "stale"; if (!basis || calendarChanged(basis, { ...basis, ...normalized, id: basis.id })) options.invalidateCalendar(); }
      options.changed(); return { phase: operation.phase, error: operation.error };
    }
  }
  const publicState: PlanningEventsState = {
    events: () => ({ events: visible(), readStatus: options.active() ? readStatus : "not-loaded", coverage, operations: options.active() ? [...operations.values()].map(operation => ({ ...operation, draft: structuredClone(operation.draft) })) : [] }),
    refreshEvents: refresh,
    createEvent: (id, draft) => save(id, { ...draft, status: "planned" }),
    updateEvent: (id, basis, draft) => save(id, draft, basis),
    async checkEventOutcome(id) {
      const operation = operations.get(id); if (!operation || operation.phase !== "unconfirmed" || !options.active()) return false;
      operation.checking = true; options.changed(); const generation = options.generation();
      const result = await refresh();
      if (options.active() && generation === options.generation()) { operation.checking = false; options.changed(); }
      return result;
    },
  };
  return { publicState, beginRead, acceptRead, failed,
    projectConfirmed: (data: PlanningShellState): PlanningShellState => ({ ...data, events: denied ? [] : records }),
    projectVisible: (data: PlanningShellState): PlanningShellState => ({ ...data, events: visible() }),
    clear() { records = []; operations.clear(); reads.clear(); accepted.clear(); receipts.clear(); barriers.length = 0; coverage = null; readStatus = "not-loaded"; },
  };
}
