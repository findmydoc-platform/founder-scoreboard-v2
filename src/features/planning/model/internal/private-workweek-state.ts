import type { PrivateWorkweekAdapter, PrivateWorkweekContext, PrivateWorkweekOperation, PrivateWorkweekPublicationConfirmation, PrivateWorkweekReply, PrivateWorkweekSaveConfirmation, PrivateWorkweekSaveInput, PrivateWorkweekView, WorkweekReconciliationConfirmation, WorkweekOperationHistory, WorkweekRestartConfirmation, WorkweekConflictRead, WorkweekConflictDecisionView, WorkweekConflictConfirmation, PrivateWorkweekPublication, WorkweekConflictPublication } from "@/features/team-workweek/model/private-workweek-planning-state";

function idle<Input>(): PrivateWorkweekOperation<Input> { return { phase: "idle", submitted: null, error: "", checked: false }; }
function emptyDecision(): WorkweekConflictDecisionView { return { phase: "idle", submitted: null, basis: null, result: null, error: "", checked: false }; }
function empty(): PrivateWorkweekView { return { recovery: { restartVersionId: null, resumablePublication: null }, currentContextReady: false, history: [], resume: { phase: "idle", submitted: null, result: null, error: "", checked: false }, restart: { phase: "idle", submitted: null, result: null, error: "", checked: false }, conflict: null, conflictReadStatus: "not-loaded", conflictDecision: emptyDecision(), reconciliation: { phase: "idle", displayedPublication: null, result: null, error: "", checked: false }, context: null, savedVersion: null, confirmedPublication: null, readStatus: "not-loaded", contextRefreshRequired: false, save: idle(), publication: { ...idle(), result: null, sourceVersion: null, conflict: null, completionPending: false } }; }
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

function fullPublication(publication: WorkweekConflictPublication): PrivateWorkweekPublication | null {
  return typeof publication.id === "string" && typeof publication.publicationRevision === "number"
    && (publication.syncState === "confirmed" || publication.syncState === "delayed")
    && (typeof publication.publishedAt === "string" || publication.publishedAt === null) && (typeof publication.lastSyncAt === "string" || publication.lastSyncAt === null)
    ? publication as PrivateWorkweekPublication : null;
}

export function createPrivateWorkweekState({ adapter, active, generation, changed, published, publicationBlocked = () => false }: { adapter: PrivateWorkweekAdapter; active(): boolean; generation(): number; changed(): void; published(): void; publicationBlocked?(): boolean }) {
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
  function denyConflict() { conflictAuthority++; sequence++; conflictRequest = null; update({ conflict: null, conflictReadStatus: "forbidden", contextRefreshRequired: true, currentContextReady: false }); }
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
        return { status: 409, value: { code: "superseded", error: "Die Varianten wurden inzwischen geändert." } };
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
    update({ conflictReadStatus: "loading", currentContextReady: false });
    void promise.finally(() => { if (conflictRequest?.promise === promise) conflictRequest = null; });
    return promise;
  }
  const busy = () => state.save.phase === "saving" || state.publication.phase === "publishing" || state.reconciliation.phase === "reconciling" || state.conflictDecision.phase === "resolving" || state.restart.phase === "restarting" || state.resume.phase === "resuming";
  const unchecked = () => [state.save, state.publication, state.reconciliation, state.conflictDecision, state.restart, state.resume].some(operation => operation.phase === "unconfirmed" && !operation.checked);
  const recoveryContextCurrent = () => !denied && state.readStatus === "current" && state.conflictReadStatus === "current" && contextAcceptedAt === sequence && !busy() && !unchecked();
  function recoveryPermission() {
    const pending = state.context?.pendingPublication;
    const target = pending ? !pending.resumeAllowed ? pending.sourceVersionId : null : state.context?.restartAvailable ? state.context.version?.id : null;
    const delayedContinuation = !denied && state.readStatus === "current" && state.conflictReadStatus === "current" && !busy() && !unchecked() && state.restart.phase === "delayed" && state.restart.submitted?.versionId === target;
    return { restartVersionId: (recoveryContextCurrent() || delayedContinuation) && target ? target : null,
      resumablePublication: recoveryContextCurrent() && pending?.resumeAllowed ? { id: pending.id, sourceVersionId: pending.sourceVersionId } : null };
  }
  const blocked = () => busy() || state.contextRefreshRequired || (!state.currentContextReady && (state.save.phase === "unconfirmed" || state.publication.phase === "unconfirmed" || state.reconciliation.phase === "unconfirmed" || ["preparing", "unconfirmed"].includes(state.conflictDecision.phase) || state.restart.phase === "unconfirmed" || state.resume.phase === "unconfirmed"));
  function retain(kind: WorkweekOperationHistory["kind"]) {
    const operation = state[kind];
    return ["unconfirmed", "preparing", "delayed", "conflict"].includes(operation.phase) ? [...state.history, { kind, operation } as WorkweekOperationHistory] : state.history;
  }
  function blockedReply<T>(): PrivateWorkweekReply<T> { return { status: 409, value: { error: "Die Bestätigung ist noch offen. Lade zuerst den aktuellen Stand.", code: "confirmation_pending" } as NonNullable<PrivateWorkweekReply<T>["value"]> }; }
  function failureStatus(error: unknown) { return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 0; }
  function unavailable(error: unknown) { return error instanceof Error ? error.message : "Die Bestätigung ist noch offen."; }
  function rejectAccess() { denied = true; authority++; sequence++; update({ readStatus: "forbidden", contextRefreshRequired: true, currentContextReady: false }); }
  function uncertain(status: number) { return status === 0 || status >= 500 || (status >= 200 && status < 300); }
  function update(patch: Partial<PrivateWorkweekView>) { state = freeze({ ...state, ...structuredClone(patch) }); publicView = freeze({ ...state, recovery: recoveryPermission(), ...(state.conflictReadStatus === "forbidden" ? { conflict: null, conflictDecision: emptyDecision(), history: state.history.filter(entry => entry.kind !== "conflictDecision") } : {}) }); changed(); }
  function ended<T>(): PrivateWorkweekReply<T> { return { status: 409, value: { error: "Die Sitzung wurde ersetzt.", code: "session_ended" } as NonNullable<PrivateWorkweekReply<T>["value"]> }; }
  async function load(week?: string): Promise<PrivateWorkweekReply<PrivateWorkweekContext>> {
    if (!active()) return ended();
    const token = generation(); const started = ++sequence;
    update({ readStatus: "loading", currentContextReady: false });
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
        return { status: conflictResult.status || 503, value: { error: conflictResult.value?.error || "Die Varianten konnten nicht geladen werden." } };
      }
      const incoming = [result.value.latestPublished, result.value.publication, result.value.preparedSuccessor];
      const known = [state.context?.latestPublished, state.context?.publication, state.context?.preparedSuccessor, state.confirmedPublication];
      if (incoming.some(publication => publication && known.some(previous => previous?.id === publication.id && previous.publicationRevision > publication.publicationRevision))) {
        update({ readStatus: "stale", contextRefreshRequired: true });
        return { status: 409, value: { code: "superseded", error: "Eine neuere Veröffentlichung ist bereits bekannt. Lade den aktuellen Stand erneut." } };
      }
      const previousPublished = state.context?.latestPublished;
      const nextPublished = result.value.latestPublished;
      const publicationChangedDuringCheck = ([state.save, state.publication, state.reconciliation, state.conflictDecision, state.restart, state.resume].some(operation => operation.phase === "unconfirmed")) && Boolean(previousPublished || nextPublished)
        && (previousPublished?.id !== nextPublished?.id || previousPublished?.publicationRevision !== nextPublished?.publicationRevision
          || previousPublished?.effectiveAt !== nextPublished?.effectiveAt || previousPublished?.effectiveUntil !== nextPublished?.effectiveUntil);
      denied = false;
      contextAcceptedAt = started;
      const boundPending = state.publication.phase === "unconfirmed" && result.value.pendingPublication?.sourceVersionId === state.publication.submitted?.versionId;
      const unknown = state.resume.phase === "unconfirmed" || state.restart.phase === "unconfirmed" || state.save.phase === "unconfirmed" || (state.publication.phase === "unconfirmed" && !boundPending) || state.reconciliation.phase === "unconfirmed" || state.conflictDecision.phase === "unconfirmed";
      // A current editing token authorizes a new deliberate write, not proof of an earlier outcome.
      const currentContextReady = Boolean(result.value.weekContext?.contextToken && !result.value.pendingPublication && !state.conflict && state.conflictReadStatus === "current" && result.value.publication?.status !== "preparing");
      update({ context: result.value as PrivateWorkweekContext, readStatus: "current", currentContextReady, contextRefreshRequired: unknown && !currentContextReady,
        resume: { ...state.resume, checked: state.resume.phase === "unconfirmed" || state.resume.checked },
        restart: { ...state.restart, checked: state.restart.phase === "unconfirmed" || state.restart.checked },
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
    if (state.publication.phase === "preparing" && !state.currentContextReady) return blockedReply();
    const unsettled = state.history.length > 0 || [state.save, state.publication, state.reconciliation, state.conflictDecision, state.restart, state.resume].some(operation => ["unconfirmed", "preparing", "delayed", "conflict"].includes(operation.phase));
    if (state.currentContextReady && unsettled && (input.contextToken !== state.context?.weekContext?.contextToken || input.selectedWeekStart !== state.context?.weekContext?.weekStart)) {
      return { status: 409, value: { code: "edit_context_stale", error: "Diese Eingaben gehören zu einem anderen Bearbeitungsstand. Lade die ausgewählte Woche und prüfe sie vor dem Speichern." } };
    }

    const token = generation(); const audience = authority; const started = ++sequence;
    const currentContextReady = state.currentContextReady;
    const submitted = structuredClone(input);
    update({ history: retain("save"), currentContextReady: false, save: { phase: "saving", submitted, error: "", checked: false } });
    let result: PrivateWorkweekReply<PrivateWorkweekSaveConfirmation>;
    try { result = await adapter.savePrivateWorkweek!(submitted); }
    catch (error) { result = { status: failureStatus(error), value: { error: unavailable(error) } }; }
    if (!active() || token !== generation() || audience !== authority) return ended();
    ++sequence;
    if (result.status === 401 || result.status === 403) rejectAccess();
    if (result.status >= 200 && result.status < 300 && result.value?.version) {
      const version = { ...result.value.version, windows: submitted.windows };
      update({ currentContextReady: currentContextReady && contextAcceptedAt <= started && state.readStatus !== "unavailable" && state.readStatus !== "forbidden", savedVersion: version, contextRefreshRequired: contextAcceptedAt > started || state.contextRefreshRequired, readStatus: state.readStatus === "loading" ? "stale" : state.readStatus, context: contextAcceptedAt > started ? state.context : state.context ? { ...state.context, version, publication: null } : null, save: { ...state.save, phase: "confirmed" } });
    } else update({ contextRefreshRequired: uncertain(result.status) || state.contextRefreshRequired, save: { ...state.save, phase: uncertain(result.status) ? "unconfirmed" : "rejected", error: result.value?.error || "Private Arbeitswoche konnte nicht gespeichert werden." } });
    return result;
  }
  async function publish(versionId: string): Promise<PrivateWorkweekReply<PrivateWorkweekPublicationConfirmation>> {
    if (!active()) return ended();
    if (publicationBlocked()) return blockedReply();
    if (denied || blocked()) return blockedReply();
    if (!state.currentContextReady && state.publication.phase === "preparing" && state.publication.submitted?.versionId !== versionId) return blockedReply();
    const token = generation(); const audience = authority; const started = ++sequence;
    const sourceVersion = state.context?.version?.id === versionId ? state.context.version : state.savedVersion?.id === versionId ? state.savedVersion : null;
    update({ history: retain("publication"), currentContextReady: false, publication: { phase: "publishing", submitted: { versionId }, error: "", checked: false, result: null, sourceVersion, conflict: null, completionPending: false } });
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
    if (publicationBlocked()) return blockedReply();
    if (denied || blocked()) return blockedReply();
    const token = generation(); const audience = authority; ++sequence;
    const publication = state.context?.latestPublished;
    const displayedPublication = publication ? { id: publication.id, publicationRevision: publication.publicationRevision } : null;
    update({ history: retain("reconciliation"), currentContextReady: false, reconciliation: { phase: "reconciling", displayedPublication, result: null, error: "", checked: false } });
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
  async function resume(pending: Pick<import("@/features/team-workweek/model/team-workweek-draft").PendingTeamWorkweekPublication, "id" | "sourceVersionId">): Promise<PrivateWorkweekReply<PrivateWorkweekPublicationConfirmation>> {
    if (!active()) return ended();
    if (publicationBlocked()) return blockedReply();
    const current = state.context?.pendingPublication;
    if (!recoveryContextCurrent() || !current?.resumeAllowed || current.id !== pending.id || current.sourceVersionId !== pending.sourceVersionId) return blockedReply();
    const token = generation(); const audience = authority; ++sequence;
    update({ history: retain("resume"), currentContextReady: false, resume: { phase: "resuming", submitted: { publicationId: pending.id, versionId: pending.sourceVersionId }, result: null, error: "", checked: false } });
    let result: PrivateWorkweekReply<PrivateWorkweekPublicationConfirmation>;
    try { result = await adapter.publishPrivateWorkweek!(pending.sourceVersionId); }
    catch (error) { result = { status: failureStatus(error), value: { error: unavailable(error) } }; }
    if (!active() || token !== generation() || audience !== authority) return ended();
    ++sequence;
    if (result.status === 401 || result.status === 403) rejectAccess();
    if ([200, 202].includes(result.status) && result.value?.publication) {
      const publication = result.value.publication;
      const completeReceipt = fullPublication(publication);
      const linked = completeReceipt && publication.id === pending.id && state.publication.submitted?.versionId === pending.sourceVersionId;
      update({ contextRefreshRequired: true, resume: { ...state.resume, phase: publication.status === "published" ? "confirmed" : "preparing", result: publication },
        ...(publication.status === "published" && completeReceipt ? { confirmedPublication: completeReceipt } : {}),
        ...(publication.status === "published" && linked ? { publication: { ...state.publication, phase: "confirmed", result: publication, checked: true } } : {}) });
      if (publication.status === "published") published();
    } else {
      const unknown = uncertain(result.status) || result.value?.code === "session_superseded";
      update({ contextRefreshRequired: true, resume: { ...state.resume, phase: unknown ? "unconfirmed" : "rejected", error: result.value?.error || "Die frühere Veröffentlichung konnte nicht bestätigt werden." } });
    }
    return result;
  }
  async function restart(versionId: string): Promise<PrivateWorkweekReply<WorkweekRestartConfirmation>> {
    if (!active()) return ended();
    if (publicationBlocked()) return blockedReply();
    const context = state.context;
    const pending = context?.pendingPublication;
    if (recoveryPermission().restartVersionId !== versionId) return blockedReply();
    const token = generation(); const audience = authority; const started = ++sequence;
    update({ history: retain("restart"), currentContextReady: false, restart: { phase: "restarting", submitted: { versionId, pendingPublicationId: pending?.sourceVersionId === versionId ? pending.id : null }, result: null, error: "", checked: false } });
    let result: PrivateWorkweekReply<WorkweekRestartConfirmation>;
    try { result = await adapter.restartPrivateWorkweek!(versionId); }
    catch (error) { result = { status: failureStatus(error), value: { error: unavailable(error) } }; }
    if (!active() || token !== generation() || audience !== authority) return ended();
    ++sequence;
    if (result.status === 401 || result.status === 403) rejectAccess();
    if ([200, 202].includes(result.status) && result.value?.restart && (result.value.restart.state !== "ready" || result.value.version)) {
      const outcome = result.value as WorkweekRestartConfirmation;
      update({ contextRefreshRequired: outcome.restart.state === "ready" || state.contextRefreshRequired, restart: { ...state.restart, phase: outcome.restart.state, result: outcome },
        ...(outcome.restart.state === "ready" && outcome.version ? { savedVersion: outcome.version,
          ...(state.context && contextAcceptedAt <= started ? { context: { ...state.context, version: outcome.version } } : {}) } : {}) });
    } else {
      const unknown = uncertain(result.status) || result.value?.code === "session_superseded";
      update({ contextRefreshRequired: unknown || state.contextRefreshRequired, restart: { ...state.restart, phase: unknown ? "unconfirmed" : "rejected", error: result.value?.error || "Neustart konnte nicht bestätigt werden." } });
    }
    return result;
  }
  async function resolveConflict(basis: import("@/features/team-workweek/model/team-workweek-draft").TeamWorkweekConflict, decision: "founderops" | "google"): Promise<PrivateWorkweekReply<WorkweekConflictConfirmation>> {
    if (!active()) return ended();
    if (publicationBlocked()) return blockedReply();
    const submitted = { conflictId: basis.id, conflictRevision: basis.conflictRevision, decision };
    const current = state.conflict;
    if (denied || state.readStatus !== "current" || state.conflictReadStatus !== "current"
      || busy()) return blockedReply();
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
    update({ history: retain("conflictDecision"), currentContextReady: false, conflictDecision: { ...emptyDecision(), phase: "resolving", basis, submitted } });
    let result: PrivateWorkweekReply<WorkweekConflictConfirmation>;
    try { result = await adapter.resolveWorkweekConflict!(submitted); }
    catch (error) { result = { status: failureStatus(error), value: { error: unavailable(error) } }; }
    if (!active() || token !== generation() || audience !== authority || access !== conflictAuthority) return ended();
    ++sequence;
    if (result.status === 401 || result.status === 403) denyConflict();
    if ([200, 202].includes(result.status) && result.value?.publication) {
      const publication = result.value.publication;
      const completeReceipt = fullPublication(publication);
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
  return {
    publicationBusy: busy,
    disconnectBinding: () => JSON.stringify([state.context?.version?.id, state.context?.pendingPublication?.id, state.context?.latestPublished?.id, state.context?.latestPublished?.publicationRevision, state.conflict?.id, state.conflict?.conflictRevision, state.save.phase, state.publication.phase, state.reconciliation.phase, state.conflictDecision.phase, state.restart.phase, state.resume.phase]),
    connectionChanged() { ++sequence; update({ currentContextReady: false, contextRefreshRequired: true, readStatus: "stale" }); },
    publicState: { resumeWorkweekPublication: resume, restartWorkweek: restart, resolveWorkweekConflict: resolveConflict, loadWorkweekConflict: loadConflict, reconcileWorkweek: reconcile, privateWorkweek: () => { active(); return denied ? forbiddenView : publicView; }, loadPrivateWorkweek: load, savePrivateWorkweek: save, publishPrivateWorkweek: publish }, clear() { ++sequence; conflictAuthority++; conflictRequest = null; resolvedConflicts.clear(); contextAcceptedAt = 0; authority++; denied = false; state = freeze(empty()); publicView = state; } };
}
