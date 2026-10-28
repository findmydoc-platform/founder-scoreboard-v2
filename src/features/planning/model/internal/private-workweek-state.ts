import type { PrivateWorkweekAdapter, PrivateWorkweekContext, PrivateWorkweekOperation, PrivateWorkweekPublicationConfirmation, PrivateWorkweekReply, PrivateWorkweekSaveConfirmation, PrivateWorkweekSaveInput, PrivateWorkweekView, WorkweekReconciliationConfirmation } from "@/features/team-workweek/model/private-workweek-planning-state";

function idle<Input>(): PrivateWorkweekOperation<Input> { return { phase: "idle", submitted: null, error: "", checked: false }; }
function empty(): PrivateWorkweekView { return { reconciliation: { phase: "idle", displayedPublication: null, result: null, error: "", checked: false }, context: null, savedVersion: null, confirmedPublication: null, readStatus: "not-loaded", contextRefreshRequired: false, save: idle(), publication: { ...idle(), result: null, sourceVersion: null, conflict: null, completionPending: false } }; }
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

export function createPrivateWorkweekState({ adapter, active, generation, changed, published }: { adapter: PrivateWorkweekAdapter; active(): boolean; generation(): number; changed(): void; published(): void }) {
  let state = freeze(empty());
  let sequence = 0;
  let contextAcceptedAt = 0;
  let denied = false;
  const forbiddenView: PrivateWorkweekView = freeze({ ...empty(), readStatus: "forbidden", contextRefreshRequired: true });
  let authority = 0;
  const blocked = () => state.save.phase === "saving" || state.publication.phase === "publishing" || state.save.phase === "unconfirmed" || state.publication.phase === "unconfirmed" || state.reconciliation.phase === "reconciling" || state.reconciliation.phase === "unconfirmed" || state.contextRefreshRequired;
  function blockedReply<T>(): PrivateWorkweekReply<T> { return { status: 409, value: { error: "Die Bestätigung ist noch offen. Lade zuerst den aktuellen Stand.", code: "confirmation_pending" } as NonNullable<PrivateWorkweekReply<T>["value"]> }; }
  function failureStatus(error: unknown) { return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 0; }
  function unavailable(error: unknown) { return error instanceof Error ? error.message : "Die Bestätigung ist noch offen."; }
  function rejectAccess() { denied = true; authority++; sequence++; update({ readStatus: "forbidden", contextRefreshRequired: true }); }
  function uncertain(status: number) { return status === 0 || status >= 500 || (status >= 200 && status < 300); }
  function update(patch: Partial<PrivateWorkweekView>) { state = freeze({ ...state, ...structuredClone(patch) }); changed(); }
  function ended<T>(): PrivateWorkweekReply<T> { return { status: 409, value: { error: "Die Sitzung wurde ersetzt.", code: "session_ended" } as NonNullable<PrivateWorkweekReply<T>["value"]> }; }
  async function load(week?: string): Promise<PrivateWorkweekReply<PrivateWorkweekContext>> {
    if (!active()) return ended();
    const token = generation(); const started = ++sequence;
    update({ readStatus: "loading" });
    try {
      const result = await adapter.readPrivateWorkweek!(week);
      if (!active() || token !== generation()) return ended();
      if (started !== sequence) return { status: 409, value: { error: "Ein neuerer Stand wurde übernommen.", code: "superseded" } };
      if (result.status < 200 || result.status >= 300 || result.value?.version === undefined || typeof result.value.minimumEffectiveFrom !== "string") {
        if (result.status === 401 || result.status === 403) rejectAccess();
        else update({ readStatus: denied ? "forbidden" : "unavailable", contextRefreshRequired: true });
        return result;
      }
      const incoming = [result.value.latestPublished, result.value.publication, result.value.preparedSuccessor];
      const known = [state.context?.latestPublished, state.context?.publication, state.context?.preparedSuccessor, state.confirmedPublication];
      if (incoming.some(publication => publication && known.some(previous => previous?.id === publication.id && previous.publicationRevision > publication.publicationRevision))) {
        update({ readStatus: "stale", contextRefreshRequired: true });
        return { status: 409, value: { code: "superseded", error: "Eine neuere Veröffentlichung ist bereits bekannt. Lade den aktuellen Stand erneut." } };
      }
      const previousPublished = state.context?.latestPublished;
      const nextPublished = result.value.latestPublished;
      const publicationChangedDuringCheck = state.reconciliation.phase === "unconfirmed" && Boolean(previousPublished || nextPublished)
        && (previousPublished?.id !== nextPublished?.id || previousPublished?.publicationRevision !== nextPublished?.publicationRevision
          || previousPublished?.effectiveAt !== nextPublished?.effectiveAt || previousPublished?.effectiveUntil !== nextPublished?.effectiveUntil);
      denied = false;
      contextAcceptedAt = started;
      const boundPending = state.publication.phase === "unconfirmed" && result.value.pendingPublication?.sourceVersionId === state.publication.submitted?.versionId;
      const unknown = state.save.phase === "unconfirmed" || (state.publication.phase === "unconfirmed" && !boundPending) || state.reconciliation.phase === "unconfirmed";
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
  return { publicState: { reconcileWorkweek: reconcile, privateWorkweek: () => { active(); return denied ? forbiddenView : state; }, loadPrivateWorkweek: load, savePrivateWorkweek: save, publishPrivateWorkweek: publish }, clear() { ++sequence; contextAcceptedAt = 0; authority++; denied = false; state = freeze(empty()); } };
}
