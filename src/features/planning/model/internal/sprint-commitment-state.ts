import type { PlanningShellState, SprintCommitment } from "@/lib/types";
import type { SprintCommitmentConfirmation, SprintCommitmentEditView, SprintCommitmentEditor, SprintCommitmentPatch, SprintCommitmentResult } from "@/features/sprint/model/sprint-commitment-editing";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "../planning-state";

const identity = (row: Pick<SprintCommitment, "sprintId" | "profileId">) => JSON.stringify([row.sprintId, row.profileId]);
export function createSprintCommitmentState(options: {
  current(): PlanningShellState;
  update(data: PlanningShellState): void;
  changed(): void;
  active(): boolean;
  generation(): number;
  nextSequence(): number;
  refresh(): Promise<boolean>;
  readStatus(): PlanningReadStatus;
  dependencyPending(sprintId: string): boolean;
  checkDependency(sprintId: string): Promise<unknown>;
  save?: (basis: SprintCommitment, patch: SprintCommitmentPatch) => Promise<SprintCommitmentConfirmation>;
}) {
  const checks = new Map<string, Promise<PlanningTaskSaveCheck>>();
  const tails = new Map<string, { context: symbol; result: Promise<SprintCommitmentResult> }>();
  const stamps = new Map<string, number>();
  const readStamps = new Map<string, number>();
  let completeRead = 0;
  const conflicts = new Map<string, string>();
  const uncertain = new Set<string>();
  const editors = new Map<symbol, { key: string; view(): SprintCommitmentEditView; resume(): SprintCommitmentEditor; releaseBlocked(): void }>();
  const pending = new Map<symbol, { basis: SprintCommitment; patch: SprintCommitmentPatch }>();
  return {
    pending: (sprintId?: string) => [...pending.values()].some(item => !sprintId || item.basis.sprintId === sprintId) || [...conflicts.values()].some(id => !sprintId || id === sprintId),
    project(data: PlanningShellState) {
      const rows = new Map(data.sprintCommitments.map(row => [identity(row), row]));
      for (const { basis, patch } of pending.values()) rows.set(identity(basis), { ...(rows.get(identity(basis)) || basis), ...patch });
      return { ...data, sprintCommitments: [...rows.values()] };
    },
    acceptRead(rows: readonly SprintCommitment[], coverage: "complete" | "partial" | undefined, started: number) {
      const current = options.current().sprintCommitments;
      if (!coverage) return { rows: current, stale: false };
      if (completeRead > started) return { rows: current, stale: true };
      const merged = new Map((coverage === "partial" ? current : []).map(row => [identity(row), row]));
      let stale = false;
      for (const row of rows) {
        if (Math.max(stamps.get(identity(row)) || 0, readStamps.get(identity(row)) || 0) <= started) {
          merged.set(identity(row), row);
          readStamps.set(identity(row), started);
        }
      }
      for (const row of current) {
        if (Math.max(stamps.get(identity(row)) || 0, readStamps.get(identity(row)) || 0) > started) {
          merged.set(identity(row), row);
          stale = true;
        }
      }
      if (coverage === "complete") completeRead = started;
      return { rows: [...merged.values()], stale };
    },
    views: (sprintId: string, profileId: string) => options.active()
      ? [...editors.values()].filter(item => item.key === identity({ sprintId, profileId })).map(item => item.view()) : [],
    resume(sprintId: string, profileId: string) {
      return [...editors.values()].findLast(item => item.key === identity({ sprintId, profileId })
        && ["unconfirmed", "conflict", "blocked", "saving"].includes(item.view().phase))?.resume() || null;
    },
    begin(shown: SprintCommitment): SprintCommitmentEditor {
      const generation = options.generation();
      let closed = false;
      const active = () => options.active() && generation === options.generation();
      const ended = (): SprintCommitmentResult => ({ ok: false, kind: "sessionSuperseded", error: "Die Bearbeitung wurde beendet." });
      let basis = structuredClone(shown);
      let view: SprintCommitmentEditView = { phase: "editing", submitted: null, serverCommitment: null, error: "", canResave: false };
      const key = identity(shown);
      const context = Symbol();
      const readView = () => !active()
        ? { ...view, phase: "ended" as const, submitted: null, serverCommitment: null, canResave: false } : structuredClone(view);
      const editor: SprintCommitmentEditor = {
        view: readView,
        save(suppliedPatch) {
          const patch = structuredClone(suppliedPatch);
          if (closed || !active()) return Promise.resolve(ended());
          if (uncertain.has(key) || conflicts.has(key) || options.dependencyPending(basis.sprintId)) {
            view = { ...view, phase: "blocked", submitted: patch, error: "Die vorherige Speicherung ist noch nicht bestätigt." };
            options.changed();
            return Promise.resolve({ ok: false, kind: "unconfirmed", error: view.error } as const);
          }
          const previous = tails.get(key);
          let originalBasis = structuredClone(basis);
          const operation = Symbol();
          pending.set(operation, { basis, patch });
          view = { ...view, phase: "saving", submitted: patch };
          options.changed();
          const saved = (async (): Promise<SprintCommitmentResult> => {
            if (previous) {
              const predecessor = await previous.result;
              if (!predecessor.ok) {
                pending.delete(operation);
                view = { ...view, phase: "blocked", error: predecessor.error };
                options.changed();
                return predecessor;
              }
              if (previous.context === context) originalBasis = structuredClone(predecessor.commitment);
            }
            if (!active()) return ended();
            const started = options.nextSequence();
            try {
              if (!options.save || (originalBasis.id !== 0 && !originalBasis.updatedAt)) throw Object.assign(new Error("Lade das Commitment neu, bevor du speicherst."), { status: 400 });
              const current = options.current().sprintCommitments.find(row => identity(row) === key);
              if (current?.updatedAt !== originalBasis.updatedAt && (current || originalBasis.id !== 0)) {
                throw Object.assign(new Error("Das Commitment wurde zwischenzeitlich geändert. Eingaben bleiben erhalten."), { status: 409, code: "commitment_revision_conflict" });
              }
              const result = await options.save!(originalBasis, patch);
              if (!active()) return ended();
              if (!result.commitment.updatedAt || !result.commitment.id || identity(result.commitment) !== key) throw new Error("Die Speicherung ist noch nicht bestätigt.");
              const rows = options.current().sprintCommitments;
              stamps.set(key, options.nextSequence());
              const latest = rows.find(row => identity(row) === key);
              const foreign = (readStamps.get(key) || 0) > started && latest?.updatedAt !== originalBasis.updatedAt && latest?.updatedAt !== result.commitment.updatedAt;
              if (!foreign) options.update({ ...options.current(), sprintCommitments: [...rows.filter(row => identity(row) !== key), result.commitment] });
              pending.delete(operation);
              basis = result.commitment;
              for (const other of editors.values()) if (other.key === key) other.releaseBlocked();
              view = { ...view, phase: "saved", error: result.auditError || "" };
              options.changed();
              return { ok: true, ...result };
            } catch (error) {
              if (!active()) return ended();
              const failure = error as { status?: number; code?: string };
              const conflict = failure.code === "commitment_revision_conflict";
              const unknown = !conflict && (failure.status === undefined || failure.status >= 500 || failure.code === "session_superseded");
              if (conflict) conflicts.set(key, basis.sprintId);
              if (unknown) uncertain.add(key); else pending.delete(operation);
              view = { ...view, phase: conflict ? "conflict" : unknown ? "unconfirmed" : "rejected", error: error instanceof Error ? error.message : "Commitment konnte nicht gespeichert werden." };
              options.changed();
              return { ok: false, kind: conflict ? "versionConflict" : failure.code === "session_superseded" ? "sessionSuperseded" : unknown ? "unconfirmed" : "rejected", error: view.error };
            }
          })();
          tails.set(key, { context, result: saved });
          void saved.then(() => { if (tails.get(key)?.result === saved && !uncertain.has(key)) tails.delete(key); });
          return saved;
        },
        async refreshConflict() {
          if (view.phase !== "conflict" || !active()) return false;
          const started = options.nextSequence();
          const loaded = await options.refresh();
          if (!active()) return false;
          const current = options.current().sprintCommitments.find(row => identity(row) === key);
          const returned = current ? (readStamps.get(key) || 0) > started : completeRead > started;
          view = { ...view, serverCommitment: loaded && returned ? current || { ...basis, id: 0, updatedAt: undefined } : null, canResave: Boolean(loaded && returned && (current?.updatedAt || !current)) };
          options.changed();
          return view.canResave;
        },
        resave(patch) {
          if (!view.canResave || !view.serverCommitment) return Promise.resolve({ ok: false, kind: "rejected", error: "Bitte zuerst vergleichen." });
          conflicts.delete(key);
          basis = structuredClone(view.serverCommitment);
          return editor.save(patch);
        },
        checkOutcome() {
          if (!active()) return Promise.resolve({ outcome: "session-ended", readStatus: "not-needed" });
          if (view.phase === "blocked" && options.dependencyPending(basis.sprintId)) return options.checkDependency(basis.sprintId).then(() => {
            if (!active()) return { outcome: "session-ended", readStatus: "not-needed" } as const;
            if (!options.dependencyPending(basis.sprintId)) view = { ...view, phase: "editing", error: "" };
            options.changed();
            return { outcome: "unconfirmed", readStatus: options.readStatus() } as const;
          });
          if (!uncertain.has(key)) {
            if (view.phase === "blocked" && !conflicts.has(key)) { view = { ...view, phase: "editing", error: "" }; options.changed(); }
            return Promise.resolve({ outcome: "not-pending", readStatus: "not-needed" });
          }
          const prior = checks.get(key);
          if (prior) return prior;
          const started = options.nextSequence();
          view = { ...view, checkStatus: "checking" };
          options.changed();
          const check = (async (): Promise<PlanningTaskSaveCheck> => {
            await options.refresh();
            if (!active()) return { outcome: "session-ended", readStatus: "not-needed" };
            const status = options.readStatus();
            const current = options.current().sprintCommitments.find(row => identity(row) === key);
            view = { ...view, checkStatus: status === "forbidden" ? "forbidden" : status === "unavailable" ? "unavailable" : "checked", serverCommitment: current && (readStamps.get(key) || 0) > started ? structuredClone(current) : null };
            options.changed();
            return { outcome: "unconfirmed", readStatus: status };
          })();
          checks.set(key, check);
          void check.then(() => { if (checks.get(key) === check) checks.delete(key); });
          return check;
        },
        close() { closed = true; if (!view.submitted) editors.delete(context); },
      };
      editors.set(context, { key, view: readView, resume: () => { closed = false; return editor; }, releaseBlocked() { if (view.phase === "blocked") view = { ...view, phase: "editing", error: "" }; } });
      return editor;
    },
    clear() {
      pending.clear(); checks.clear(); tails.clear(); stamps.clear(); readStamps.clear();
      completeRead = 0; conflicts.clear(); uncertain.clear(); editors.clear();
    },
  };
}
