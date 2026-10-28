import type { GoogleWorkspaceAdapter, GoogleWorkspaceView, GoogleDisconnectOperation, GoogleDisconnectBasis, GoogleWorkspaceReply, GoogleWorkspaceRead, GoogleDisconnectRead, GoogleDisconnectConfirmation } from "@/features/team-workweek/model/google-workspace-state";
const emptyOperation = (): GoogleDisconnectOperation => ({ phase: "idle", submitted: null, result: null, error: "", checked: false });
const empty = (): GoogleWorkspaceView => ({ connection: null, readStatus: "not-loaded", error: "", disconnectPending: false, preview: null, previewStatus: "not-loaded", previewError: "", previewBasis: null, operation: emptyOperation(), history: [], canContinue: false });
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const disconnected = { state: "not_connected" as const, connectedAt: null, refreshedAt: null, lastUsedAt: null, accessTokenExpiresAt: null };
export function createGoogleWorkspaceState({ adapter, active, generation, changed, invalidate, privateBusy = () => false, privateContext = () => "", privateChanged = () => undefined }: { adapter: GoogleWorkspaceAdapter; active(): boolean; generation(): number; changed(): void; invalidate(): void; privateBusy?(): boolean; privateContext?(): string; privateChanged?(): void }) {
  const forbidden = freeze({ ...empty(), readStatus: "forbidden" as const, previewStatus: "forbidden" as const });
  let state = freeze(empty()); let publicView = state; let epoch = 0; let denied = false; let authority = 0; let previewBinding = "";
  let statusRequest: { epoch: number; promise: Promise<GoogleWorkspaceReply<GoogleWorkspaceRead>> } | null = null;
  let previewRequest: { epoch: number; promise: Promise<GoogleWorkspaceReply<GoogleDisconnectRead>> } | null = null;
  const ended = <T>(): GoogleWorkspaceReply<T> => ({ status: 409, value: { code: "session_ended", error: "Die Sitzung wurde ersetzt." } as NonNullable<GoogleWorkspaceReply<T>["value"]> });
  function canContinue() { return !denied && !privateBusy() && state.previewStatus !== "forbidden" && state.operation.phase !== "disconnecting" && (state.operation.phase === "partial" || state.readStatus === "current" && state.disconnectPending && (state.operation.phase !== "unconfirmed" || state.operation.checked)); }
  function update(patch: Partial<GoogleWorkspaceView>) { state = freeze({ ...state, ...structuredClone(patch) }); publicView = freeze({ ...state, canContinue: canContinue(), ...(state.previewStatus === "forbidden" ? { preview: null, previewBasis: null, operation: emptyOperation(), history: [] } : {}) }); changed(); }
  function deny() { epoch++; authority++; denied = true; privateChanged(); update({ connection: null, readStatus: "forbidden", preview: null, previewBasis: null, previewStatus: "forbidden", ...(state.operation.phase === "disconnecting" ? { operation: { ...state.operation, phase: "unconfirmed", checked: false, error: "Die Berechtigung wurde während der Trennung geändert. Die Bestätigung bleibt ausstehend." } } : {}) }); }
  function denyPreview() {
    epoch++; authority++; privateChanged();
    update({ preview: null, previewBasis: null, previewStatus: "forbidden", previewError: "Trennungsvorschau ist nicht mehr verfügbar.", ...(state.operation.phase === "disconnecting" ? { operation: { ...state.operation, phase: "unconfirmed", checked: false, error: "Die Vorschau-Berechtigung wurde während der Trennung geändert. Die Bestätigung bleibt ausstehend." } } : {}) });
  }
  function load(): Promise<GoogleWorkspaceReply<GoogleWorkspaceRead>> {
    if (statusRequest?.epoch === epoch) return statusRequest.promise;
    const requestEpoch = epoch; const promise = Promise.resolve().then(readStatus);
    statusRequest = { epoch: requestEpoch, promise }; void promise.finally(() => { if (statusRequest?.promise === promise) statusRequest = null; }); return promise;
  }
  function preview(): Promise<GoogleWorkspaceReply<GoogleDisconnectRead>> {
    if (previewRequest?.epoch === epoch) return previewRequest.promise;
    const requestEpoch = epoch; const promise = Promise.resolve().then(readPreview);
    previewRequest = { epoch: requestEpoch, promise }; void promise.finally(() => { if (previewRequest?.promise === promise) previewRequest = null; }); return promise;
  }
  async function readStatus(): Promise<GoogleWorkspaceReply<GoogleWorkspaceRead>> {
    if (!active()) return ended(); const token = generation(); const started = epoch;
    update({ readStatus: "loading", error: "" });
    let result: GoogleWorkspaceReply<GoogleWorkspaceRead>;
    try { result = await adapter.readGoogleWorkspace!(); } catch (error) { result = { status: errorStatus(error), value: { error: message(error) } }; }
    if (!active() || token !== generation() || started !== epoch) return ended();
    if (result.status >= 200 && result.status < 300 && result.value?.connection) {
      if (state.operation.phase === "completed" && (result.value.connection.state !== "not_connected" || result.value.disconnectPending)) {
        update({ readStatus: "stale", error: "Die Trennung ist bestätigt. Ein älterer Verbindungsstand wird nicht übernommen." }); return result;
      }
      denied = false;
      update({ connection: result.value.connection, disconnectPending: Boolean(result.value.disconnectPending), readStatus: "current", operation: { ...state.operation, checked: state.operation.phase === "unconfirmed" || state.operation.checked } });
      if (result.value.disconnectPending) void preview();
    } else if ([401, 403].includes(result.status)) deny();
    else update({ readStatus: denied ? "forbidden" : "unavailable", error: result.value?.error || "Google-Verbindungsstatus konnte nicht geladen werden." });
    return result;
  }
  async function readPreview(): Promise<GoogleWorkspaceReply<GoogleDisconnectRead>> {
    if (!active()) return ended(); const token = generation(); const started = epoch; const binding = privateContext();
    update({ previewStatus: "loading", previewError: "", previewBasis: null });
    let result: GoogleWorkspaceReply<GoogleDisconnectRead>;
    try { result = await adapter.readGoogleDisconnect!(); } catch (error) { result = { status: errorStatus(error), value: { error: message(error) } }; }
    if (!active() || token !== generation() || started !== epoch) return ended();
    if (result.status >= 200 && result.status < 300 && result.value?.disconnect && binding === privateContext()) { previewBinding = binding; update({ preview: result.value.disconnect, previewStatus: "current", previewBasis: { kind: "google-disconnect", preview: result.value.disconnect } }); }
    else if ([401, 403].includes(result.status)) denyPreview();
    else update({ previewStatus: "unavailable", previewError: result.value?.error || "Trennungsvorschau konnte nicht geladen werden." });
    return result;
  }
  async function disconnect(basis: GoogleDisconnectBasis | null, continuation = false): Promise<GoogleWorkspaceReply<GoogleDisconnectConfirmation>> {
    if (!active()) return ended();
    if (denied || privateBusy() || state.operation.phase === "disconnecting" || continuation && !canContinue() || (!continuation && (!basis || basis !== state.previewBasis || previewBinding !== privateContext() || state.previewStatus !== "current" || state.readStatus !== "current" || state.connection?.state !== "connected" || (state.operation.phase === "partial" || state.operation.phase === "unconfirmed" && (!state.operation.checked || state.disconnectPending))))) return { status: 409, value: { error: "Lade die Trennungsvorschau und bestätige erneut.", code: "preview_changed" } };
    const token = generation(); const access = authority; ++epoch;
    update({ history: ["unconfirmed", "partial"].includes(state.operation.phase) ? [...state.history, state.operation] : state.history, previewBasis: null, previewStatus: "stale", operation: { phase: "disconnecting", submitted: { confirm: true, continuation, basis }, result: null, error: "", checked: false } });
    privateChanged();
    let result: GoogleWorkspaceReply<GoogleDisconnectConfirmation>;
    try { result = await adapter.disconnectGoogleWorkspace!(); } catch (error) { result = { status: errorStatus(error), value: { error: message(error) } }; }
    if (!active() || token !== generation() || denied || access !== authority) return ended(); ++epoch;
    if ([401, 403].includes(result.status)) { deny(); return result; }
    if ([200, 202].includes(result.status) && result.value?.result) {
      const outcome = result.value.result;
      update({ operation: { ...state.operation, phase: outcome.state === "completed" ? "completed" : "partial", result: outcome }, disconnectPending: outcome.state !== "completed", ...(outcome.state === "completed" ? { connection: disconnected } : {}) });
      invalidate();
    } else { update({ operation: { ...state.operation, phase: result.status === 0 || result.status >= 500 || result.status >= 200 && result.status < 300 || result.value?.code === "session_superseded" ? "unconfirmed" : "rejected", error: result.value?.error || "Trennung konnte nicht bestätigt werden." } });
      if (state.operation.phase === "unconfirmed") invalidate();
    }
    return result;
  }
  function errorStatus(error: unknown) { return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 0; }
  function message(error: unknown) { return error instanceof Error ? error.message : "Google-Verbindung konnte nicht geprüft werden."; }
  return {
    privateContextChanged() {
      if (state.previewBasis && previewBinding !== privateContext()) { update({ previewBasis: null, previewStatus: "stale", previewError: "Der Wochenstand wurde geändert. Lade die Vorschau und bestätige erneut." }); return true; }
      if (publicView.canContinue !== canContinue()) { update({}); return true; }
      return false;
    },
    blocksPublication: () => denied || state.operation.phase === "disconnecting" || state.operation.phase === "partial" || state.disconnectPending || state.operation.phase === "unconfirmed" && !state.operation.checked, publicState: { googleWorkspace: () => { active(); return denied ? forbidden : publicView; }, loadGoogleWorkspace: load, loadGoogleDisconnectPreview: preview, disconnectGoogleWorkspace: (basis: GoogleDisconnectBasis) => disconnect(basis), continueGoogleDisconnect: () => disconnect(null, true) }, clear() { epoch++; authority++; denied = false; previewBinding = ""; statusRequest = null; previewRequest = null; state = freeze(empty()); publicView = state; } };
}
