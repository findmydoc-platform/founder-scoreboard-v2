import type { PrivateWorkweekAdapter, PrivateWorkweekContext, PrivateWorkweekOperation, PrivateWorkweekPublicationConfirmation, PrivateWorkweekReply, PrivateWorkweekSaveConfirmation, PrivateWorkweekSaveInput, PrivateWorkweekView, WorkweekReconciliationConfirmation, WorkweekConflictRead, WorkweekConflictDecisionView, WorkweekConflictConfirmation, PrivateWorkweekPublication } from "@/features/team-workweek/model/private-workweek-planning-state";

function idle<Input>(): PrivateWorkweekOperation<Input> { return { phase: "idle", submitted: null, error: "", checked: false }; }
function emptyDecision(): WorkweekConflictDecisionView { return { phase: "idle", submitted: null, basis: null, result: null, error: "", checked: false }; }
function empty(): PrivateWorkweekView { return { conflict: null, conflictReadStatus: "not-loaded", conflictDecision: emptyDecision(), reconciliation: { phase: "idle", displayedPublication: null, result: null, error: "", checked: false }, context: null, savedVersion: null, confirmedPublication: null, readStatus: "not-loaded", contextRefreshRequired: false, save: idle(), publication: { ...idle(), result: null, sourceVersion: null, conflict: null, completionPending: false } }; }
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

export function createPrivateWorkweekState({ adapter, active, generation, changed, published }: { adapter: PrivateWorkweekAdapter; active(): boolean; generation(): number; changed(): void; published(): void }) {
  let state = freeze(empty());
  let publicView = state;
  const resolvedConflicts = new Map<string, number>();
  let sequence = 0;
  let contextAcceptedAt = 0;
  let denied = false;
  const forbiddenView: PrivateWorkweekView = freeze({ ...empty(), readStatus: "forbidden", contextRefreshRequired: true });
  let authority = 0;
  let conflictAuthority = 0;
  let conflictRequest: { sequence: number; promise: Promise<PrivateWorkweekReply<WorkweekConflictRead>> } | null = null;
  function denyConflict() { conflictAuthority++; sequence++; conflictRequest = null; update({ conflict: null, conflictReadStatus: "forbidden", contextRefreshRequired: true }); }
  function loadConflict(): Promise<PrivateWorkweekReply<WorkweekConflictRead>> {
    if (!active()) return Promise.resolve(ended());
    if (conflictRequest?.sequence === sequence) return conflictRequest.promise;
    const token = generation(); const started = sequence; const access = conflictAuthority;
    const promise = Promise.resolve().then(async (): Promise<PrivateWorkweekReply<WorkweekConflictRead>> => {
      let result: PrivateWorkweekReply<WorkweekConflictRead>;
      try { result = await adapter.readWorkweekConflict!(); }
      catch (error) { result = { status: failureStatus(error), value: { error: unavailable(error) } }; }
      if (!active() || token !== generation() || access !== conflictAuthority) return ended();
      if (started !== sequence) return { status: 409, value: { code: "superseded", error: "Ein neuerer Konfliktstand ist bereits bekannt." } };
      if (result.status < 200 || result.status >= 300 || result.value?.conflict === undefined) {
        if (result.status === 401 || result.status === 403) denyConflict();
        else update({ conflictReadStatus: state.conflictReadStatus === "forbidden" ? "forbidden" : "unavailable", contextRefreshRequired: true });
      } else if (result.value.conflict && state.conflict?.id === result.value.conflict.id && state.conflict.conflictRevision > result.value.conflict.conflictRevision) {
        update({ conflictReadStatus: "stale", contextRefreshRequired: true });
        return { status: 409, value: { code: "superseded", error: "Eine neuere Konfliktrevision ist bereits bekannt." } };
      } else {
        if (result.value.conflict && (resolvedConflicts.get(result.value.conflict.id) ?? 0) >= result.value.conflict.conflictRevision) {
          update({ conflictReadStatus: "stale", contextRefreshRequired: true });
          return { status: 409, value: { code: "superseded", error: "Dieser Konflikt ist bereits bestätigt abgeschlossen." } };
        }
        const submitted = state.conflictDecision.submitted;
        const boundPending = state.conflictDecision.phase === "unconfirmed" && result.value.conflict?.id === submitted?.conflictId
          && result.value.conflict?.conflictRevision === submitted?.conflictRevision && result.value.conflict?.state === "resolving" && result.value.conflict?.decision === submitted?.decision;
        update({ conflict: result.value.conflict, conflictReadStatus: "current", conflictDecision: { ...state.conflictDecision,
          checked: state.conflictDecision.phase === "unconfirmed" || state.conflictDecision.checked, phase: boundPending ? "preparing" : state.conflictDecision.phase } });
      }
      return result;
    });
    conflictRequest = { sequence: started, promise };
    update({ conflictReadStatus: "loading" });
    void promise.finally(() => { if (conflictRequest?.promise === promise) conflictRequest = null; });
    return promise;
  }
  const blocked = () => state.save.phase === "saving" || state.publication.phase === "publishing" || state.save.phase === "unconfirmed" || state.publication.phase === "unconfirmed" || state.reconciliation.phase === "reconciling" || state.reconciliation.phase === "unconfirmed" || ["resolving", "preparing", "unconfirmed"].includes(state.conflictDecision.phase) || state.contextRefreshRequired;
  function blockedReply<T>(): PrivateWorkweekReply<T> { return { status: 409, value: { error: "Die Bestätigung ist noch offen. Lade zuerst den aktuellen Stand.", code: "confirmation_pending" } as NonNullable<PrivateWorkweekReply<T>["value"]> }; }
  function failureStatus(error: unknown) { return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 0; }
  function unavailable(error: unknown) { return error instanceof Error ? error.message : "Die Bestätigung ist noch offen."; }
  function rejectAccess() { denied = true; authority++; sequence++; update({ readStatus: "forbidden", contextRefreshRequired: true }); }
  function uncertain(status: number) { return status === 0 || status >= 500 || (status >= 200 && status < 300); }
  function update(patch: Partial<PrivateWorkweekView>) { state = freeze({ ...state, ...structuredClone(patch) }); publicView = state.conflictReadStatus === "forbidden" ? freeze({ ...state, conflict: null, conflictDecision: emptyDecision() }) : state; changed(); }
  function ended<T>(): PrivateWorkweekReply<T> { return { status: 409, value: { error: "Die Sitzung wurde ersetzt.", code: "session_ended" } as NonNullable<PrivateWorkweekReply<T>["value"]> }; }
  async function load(week?: string): Promise<PrivateWorkweekReply<PrivateWorkweekContext>> {
    if (!active()) return ended();
    const token = generation(); const started = ++sequence;
    update({ readStatus: "loading" });
    try {
      const conflictRead = adapter.readWorkweekConflict ? loadConflict() : Promise.resolve(null);
      const [result, conflictResult] = await Promise.all([adapter.readPrivateWorkweek!(week), conflictRead]);
      if (!active() || token !== generation()) return ended();
      if (started !== sequence) return { status: 409, value: { error: "Ein neuerer Stand wurde übernommen.", code: "superseded" } };
      if (result.status < 200 || result.status >= 300 || result.value?.version === undefined || typeof result.value.minimumEffectiveFrom !== "string") {
        if (result.status === 401 || result.status === 403) rejectAccess();
        else update({ readStatus: denied ? "forbidden" : "unavailable", contextRefreshRequired: true });
        return result;
      }
      if (conflictResult && (conflictResult.status < 200 || conflictResult.status >= 300 || conflictResult.value?.conflict === undefined)) {
        update({ readStatus: "unavailable", contextRefreshRequired: true });
        return { status: conflictResult.status || 503, value: { error: conflictResult.value?.error || "Der Konfliktkontext konnte nicht geladen werden." } };
      }
      const incoming = [result.value.latestPublished, result.value.publication, result.value.preparedSuccessor];
      const known = [state.context?.latestPublished, state.context?.publication, state.context?.preparedSuccessor, state.confirmedPublication];
      if (incoming.some(publication => publication && known.some(previous => previous?.id === publication.id && previous.publicationRevision > publication.publicationRevision))) {
        update({ readStatus: "stale", contextRefreshRequired: true });
        return { status: 409, value: { code: "superseded", error: "Eine neuere Veröffentlichung ist bereits bekannt. Lade den aktuellen Stand erneut." } };
      }
      const previousPublished = state.context?.latestPublished;
      const nextPublished = result.value.latestPublished;
      const publicationChangedDuringCheck = (state.reconciliation.phase === "unconfirmed" || state.conflictDecision.phase === "unconfirmed") && Boolean(previousPublished || nextPublished)
        && (previousPublished?.id !== nextPublished?.id || previousPublished?.publicationRevision !== nextPublished?.publicationRevision
          || previousPublished?.effectiveAt !== nextPublished?.effectiveAt || previousPublished?.effectiveUntil !== nextPublished?.effectiveUntil);
      denied = false;
      contextAcceptedAt = started;
      const boundPending = state.publication.phase === "unconfirmed" && result.value.pendingPublication?.sourceVersionId === state.publication.submitted?.versionId;
      const unknown = state.save.phase === "unconfirmed" || (state.publication.phase === "unconfirmed" && !boundPending) || state.reconciliation.phase === "unconfirmed" || state.conflictDecision.phase === "unconfirmed";
      update({ context: result.value as PrivateWorkweekContext, readStatus: "current", contextRefreshRequired: unknown,
        save: { ...state.save, checked: state.save.phase === "unconfirmed" || state.save.checked },
        reconciliation: { ...state.reconciliation, checked: state.reconciliation.phase === "unconfirmed" || state.reconciliation.checked },
        publication: { ...state.publication, phase: boundPending ? "preparing" : state.publication.phase, checked: state.publication.phase === "unconfirmed" || state.publication.checked } });
      if (publicationChangedDuringCheck) published();
      return result;
    } catch (error) {
      if (!active() || token !== generation()) return ended();
      const status = failureStatus(error);
      if (started === sequence) {
        if (status === 401 || status === 403) rejectAccess();
        else update({ readStatus: denied ? "forbidden" : "unavailable", contextRefreshRequired: true });
      }
      return { status, value: { error: error instanceof Error ? error.message : "Private Arbeitswoche konnte nicht geladen werden." } };
    }
  }
  async function save(input: PrivateWorkweekSaveInput): Promise<PrivateWorkweekReply<PrivateWorkweekSaveConfirmation>> {
    if (!active()) return ended();
    if (denied || blocked()) return blockedReply();
    if (state.publication.phase === "preparing") return blockedReply();
    const token = generation(); const audience = authority; const started = ++sequence;
    const submitted = structuredClone(input);
    update({ save: { phase: "saving", submitted, error: "", checked: false } });
    let result: PrivateWorkweekReply<PrivateWorkweekSaveConfirmation>;
    try { result = await adapter.savePrivateWorkweek!(submitted); }
    catch (error) { result = { status: failureStatus(error), value: { error: unavailable(error) } }; }
    if (!active() || token !== generation() || audience !== authority) return ended();
    ++sequence;
    if (result.status === 401 || result.status === 403) rejectAccess();
    if (result.status >= 200 && result.status < 300 && result.value?.version) {
      const version = { ...result.value.version, windows: submitted.windows };
      update({ savedVersion: version, contextRefreshRequired: contextAcceptedAt > started || state.contextRefreshRequired, readStatus: state.readStatus === "loading" ? "stale" : state.readStatus, context: contextAcceptedAt > started ? state.context : state.context ? { ...state.context, version, publication: null } : null, save: { ...state.save, phase: "confirmed" } });
    } else update({ contextRefreshRequired: uncertain(result.status) || state.contextRefreshRequired, save: { ...state.save, phase: uncertain(result.status) ? "unconfirmed" : "rejected", error: result.value?.error || "Private Arbeitswoche konnte nicht gespeichert werden." } });
    return result;
  }
  async function publish(versionId: string): Promise<PrivateWorkweekReply<PrivateWorkweekPublicationConfirmation>> {
    if (!active()) return ended();
    if (denied || blocked()) return blockedReply();
    if (state.publication.phase === "preparing" && state.publication.submitted?.versionId !== versionId) return blockedReply();
    const token = generation(); const audience = authority; const started = ++sequence;
    const sourceVersion = state.context?.version?.id === versionId ? state.context.version : state.savedVersion?.id === versionId ? state.savedVersion : null;
    update({ publication: { phase: "publishing", submitted: { versionId }, error: "", checked: false, result: null, sourceVersion, conflict: null, completionPending: false } });
    let result: PrivateWorkweekReply<PrivateWorkweekPublicationConfirmation>;
    try { result = await adapter.publishPrivateWorkweek!(versionId); }
    catch (error) { result = { status: failureStatus(error), value: { error: unavailable(error) } }; }
    if (!active() || token !== generation() || audience !== authority) return ended();
    ++sequence;
    if (result.status === 401 || result.status === 403) rejectAccess();
    if (result.status >= 200 && result.status < 300 && result.value?.publication) {
      const publication = result.value.publication;
      const source = state.publication.sourceVersion;
      const ownPublication = source ? { id: publication.id, status: publication.status, syncState: publication.syncState, publicationRevision: publication.publicationRevision,
        effectiveFrom: source.effectiveFrom, effectiveAt: publication.effectiveAt, effectiveUntil: publication.effectiveUntil, activationMode: publication.activationMode,
        publishedAt: publication.publishedAt, lastSyncAt: publication.lastSyncAt, googleReconciliationState: "confirmed" as const, lastGoogleReconciliationAt: null } : null;
      update({ publication: { ...state.publication, result: publication, phase: publication.status === "published" ? "confirmed" : "preparing" },
        ...(state.context && ownPublication && contextAcceptedAt <= started ? { context: { ...state.context, publication: ownPublication, ...(publication.status === "published" ? { latestPublished: ownPublication } : {}) } } : {}),
        ...(publication.status === "published" ? { confirmedPublication: publication, contextRefreshRequired: true } : {}) });
      if (publication.status === "published") published();
    } else {
      const completionPending = Boolean(result.value?.completionPending || result.value?.code === "completion_pending");
      update({ contextRefreshRequired: completionPending || uncertain(result.status) || state.contextRefreshRequired,
        publication: { ...state.publication, completionPending, conflict: result.value?.conflict || null,
          phase: completionPending ? "preparing" : uncertain(result.status) ? "unconfirmed" : "rejected", error: result.value?.error || "Veröffentlichung konnte nicht bestätigt werden." } });
    }
    return result;
  }
  async function reconcile(): Promise<PrivateWorkweekReply<WorkweekReconciliationConfirmation>> {
    if (!active()) return ended();
    if (denied || blocked()) return blockedReply();
    const token = generation(); const audience = authority; ++sequence;
    const publication = state.context?.latestPublished;
    const displayedPublication = publication ? { id: publication.id, publicationRevision: publication.publicationRevision } : null;
    update({ reconciliation: { phase: "reconciling", displayedPublication, result: null, error: "", checked: false } });
    let result: PrivateWorkweekReply<WorkweekReconciliationConfirmation>;
    try { result = await adapter.reconcilePrivateWorkweek!(); }
    catch (error) { result = { status: failureStatus(error), value: { error: unavailable(error) } }; }
    if (!active() || token !== generation() || audience !== authority) return ended();
    ++sequence;
    if (result.status === 401 || result.status === 403) rejectAccess();
    if (result.value?.reconciliation && [200, 202, 409].includes(result.status)) {
      const reconciliation = result.value.reconciliation;
      update({ contextRefreshRequired: true, reconciliation: { ...state.reconciliation, result: reconciliation,
        phase: reconciliation.state === "unchanged" || reconciliation.state === "updated" ? "confirmed" : reconciliation.state } });
      if (reconciliation.state === "updated") published();
    } else update({ contextRefreshRequired: uncertain(result.status) || state.contextRefreshRequired, reconciliation: { ...state.reconciliation, phase: uncertain(result.status) ? "unconfirmed" : "rejected", error: result.value?.error || "Google-Abgleich konnte nicht abgeschlossen werden." } });
    return result;
  }
  async function resolveConflict(basis: import("@/features/team-workweek/model/team-workweek-draft").TeamWorkweekConflict, decision: "founderops" | "google"): Promise<PrivateWorkweekReply<WorkweekConflictConfirmation>> {
    if (!active()) return ended();
    const submitted = { conflictId: basis.id, conflictRevision: basis.conflictRevision, decision };
    const current = state.conflict;
    if (denied || state.readStatus !== "current" || state.conflictReadStatus !== "current"
      || state.save.phase === "saving" || state.publication.phase === "publishing" || state.reconciliation.phase === "reconciling" || state.conflictDecision.phase === "resolving") return blockedReply();
    if ((state.save.phase === "unconfirmed" && !state.save.checked) || (state.publication.phase === "unconfirmed" && !state.publication.checked) || (state.reconciliation.phase === "unconfirmed" && !state.reconciliation.checked)) return blockedReply();
    if (state.conflictDecision.phase === "unconfirmed") return blockedReply();
    if (!current || current.id !== basis.id || current.conflictRevision !== basis.conflictRevision
      || (current.state === "resolving" && current.decision !== decision)
      || (state.conflictDecision.phase === "preparing" && state.conflictDecision.submitted?.decision !== decision)) {
      const error = "Die Konfliktvariante wurde während deiner Prüfung geändert. Lade den aktuellen Stand und entscheide erneut.";
      update({ conflictDecision: state.conflictDecision.phase === "preparing" ? { ...state.conflictDecision, error } : { ...emptyDecision(), phase: "stale", basis, submitted, error } });
      return { status: 409, value: { code: "conflict_basis_changed", error } };
    }
    if (basis[decision].supported === false || current[decision].supported === false) {
      const error = "Diese Konfliktvariante kann nicht sicher übernommen werden.";
      update({ conflictDecision: state.conflictDecision.phase === "preparing" ? { ...state.conflictDecision, error } : { ...emptyDecision(), phase: "rejected", basis, submitted, error } });
      return { status: 400, value: { code: "unsupported_choice", error } };
    }
    const token = generation(); const audience = authority; const access = conflictAuthority; ++sequence;
    const pendingPublication = state.context?.pendingPublication;
    update({ conflictDecision: { ...emptyDecision(), phase: "resolving", basis, submitted } });
    let result: PrivateWorkweekReply<WorkweekConflictConfirmation>;
    try { result = await adapter.resolveWorkweekConflict!(submitted); }
    catch (error) { result = { status: failureStatus(error), value: { error: unavailable(error) } }; }
    if (!active() || token !== generation() || audience !== authority || access !== conflictAuthority) return ended();
    ++sequence;
    if (result.status === 401 || result.status === 403) denyConflict();
    if ([200, 202].includes(result.status) && result.value?.publication) {
      const publication = result.value.publication;
      const completeReceipt = typeof publication.id === "string" && typeof publication.publicationRevision === "number"
        && (publication.syncState === "confirmed" || publication.syncState === "delayed")
        && (typeof publication.publishedAt === "string" || publication.publishedAt === null) && (typeof publication.lastSyncAt === "string" || publication.lastSyncAt === null)
        ? publication as PrivateWorkweekPublication : null;
      const sameConflict = state.conflict?.id === basis.id && state.conflict.conflictRevision === basis.conflictRevision;
      const linkedPublication = completeReceipt && pendingPublication?.id === completeReceipt.id && pendingPublication.sourceVersionId === state.publication.submitted?.versionId;
      if (publication.status === "published") resolvedConflicts.set(basis.id, basis.conflictRevision);
      update({ contextRefreshRequired: true, conflictDecision: { ...state.conflictDecision, phase: publication.status, result: publication },
        ...(publication.status === "published" && sameConflict ? { conflict: null } : {}),
        ...(publication.status === "published" && completeReceipt ? { confirmedPublication: completeReceipt } : {}),
        ...(publication.status === "published" && linkedPublication ? { publication: { ...state.publication, phase: "confirmed", result: completeReceipt, checked: true } } : {}) });
      if (publication.status === "published") published();
    } else {
      const unknown = uncertain(result.status) || result.value?.code === "session_superseded";
      update({ contextRefreshRequired: unknown || state.contextRefreshRequired,
        conflictDecision: { ...state.conflictDecision, phase: unknown ? "unconfirmed" : result.status === 409 ? "stale" : "rejected", error: result.value?.error || "Die Konfliktentscheidung konnte nicht bestätigt werden." } });
    }
    return result;
  }
  return { publicState: { resolveWorkweekConflict: resolveConflict, loadWorkweekConflict: loadConflict, reconcileWorkweek: reconcile, privateWorkweek: () => { active(); return denied ? forbiddenView : publicView; }, loadPrivateWorkweek: load, savePrivateWorkweek: save, publishPrivateWorkweek: publish }, clear() { ++sequence; conflictAuthority++; conflictRequest = null; resolvedConflicts.clear(); contextAcceptedAt = 0; authority++; denied = false; state = freeze(empty()); publicView = state; } };
}
