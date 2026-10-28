import type { PlanningShellState, Sprint } from "@/lib/types";
import type { SprintEditor, SprintEditorView, SprintEditPatch, SprintEditResult } from "@/features/sprint/model/sprint-editing";
import type { PlanningTaskSaveCheck, PlanningReadStatus } from "../planning-state";
import type { PlanningReadCoverage } from "./planning-read-scopes";

export function createSprintState(options: {
  current(): PlanningShellState; update(data: PlanningShellState): void; changed(): void; active(): boolean; generation(): number; nextSequence(): number;
  save?: (sprint: Sprint, patch: SprintEditPatch) => Promise<{ sprint: Sprint }>;
  lockPending?: (id: string) => boolean; checkLock?: (id: string) => Promise<PlanningTaskSaveCheck>;
  checkDependency?: (id: string) => Promise<PlanningTaskSaveCheck>;
  dependencyPending?: (id: string) => boolean;

  planPending?: (id: string) => boolean; checkPlan?: () => Promise<PlanningTaskSaveCheck>;
  reviewWindowPending?: () => boolean; checkReviewWindow?: () => Promise<PlanningTaskSaveCheck>;
  refresh(): Promise<boolean>; readStatus(): PlanningReadStatus;
}) {
  const readStamps = new Map<string | number, number>();
  const stamps = new Map<string | number, number>();
  const scopeStamps = new Map<keyof PlanningShellState, Map<string | number, number>>();
  const completeReads = new Map<keyof PlanningShellState, number>();
  const projectStamps = new Map<string, number>();
  const pending = new Map<symbol, { id: string; patch: SprintEditPatch }>();
  const editors = new Map<symbol, { id: string; view(): SprintEditorView; releaseBlocked(): void }>();
  const tails = new Map<string, { context: symbol; result: Promise<SprintEditResult> }>();
  const uncertain = new Set<string>();
  const checks = new Map<string, Promise<PlanningTaskSaveCheck>>();
  const lockedSprints=new Set<string>();
  const lockScopeAt=new Map<string,number>();
  let denied = false;
  let reviewWindowReadAt = 0;
  let covered: PlanningReadCoverage = {};
  function checkedView(view: SprintEditorView): SprintEditorView {
    if (!options.active()) return { ...view, phase: "ended", submitted: null, serverSprint: null, canResave: false };
    return denied ? { ...view, submitted: null, serverSprint: null, canResave: false } : structuredClone(view);
  }
  async function check(id: string): Promise<PlanningTaskSaveCheck> {
    if (!options.active()) return { outcome: "session-ended", readStatus: "not-needed" };
    if (options.lockPending?.(id) && options.checkLock) return options.checkLock(id);
    if (options.dependencyPending?.(id) && options.checkDependency) return options.checkDependency(id);

    if (options.planPending?.(id) && options.checkPlan) return options.checkPlan();
    if (options.reviewWindowPending?.() && options.checkReviewWindow) return options.checkReviewWindow();
    if (!uncertain.has(id)) { for (const editor of editors.values()) if (editor.id === id) editor.releaseBlocked(); options.changed(); return { outcome: "not-pending", readStatus: "not-needed" }; }
    const existing = checks.get(id); if (existing) return existing;
    const generation = options.generation();
    const checked = (async (): Promise<PlanningTaskSaveCheck> => {
      await options.refresh();
      if (!options.active() || options.generation() !== generation) return { outcome: "session-ended", readStatus: "not-needed" };
      return { outcome: "unconfirmed", readStatus: options.readStatus() };
    })();
    checks.set(id, checked);
    void checked.finally(() => { if (checks.get(id) === checked) checks.delete(id); });
    return checked;
  }
  return {
    check,
    acceptLock(receipt: import("@/features/sprint/model/sprint-lock").SprintLockReceipt) {
      const current=options.current();const accepted=options.nextSequence();stamps.set(receipt.sprint.id,accepted);lockedSprints.add(receipt.sprint.id);for(const key of ["founderSprintScores","founderStrikeStates","strikeEvents"])lockScopeAt.set(key,accepted);
      options.update({...current,sprints:current.sprints.map(sprint=>sprint.id===receipt.sprint.id?{...sprint,...receipt.sprint,updatedAt:undefined}:sprint)});
    },
    acceptPlan(rows: import("@/lib/types").Sprint[], started: number, basis: import("@/features/sprint/model/sprint-plan").SprintPlanBasis) {
      const current = options.current();
      const next = new Map(current.sprints.map(sprint => [sprint.id, sprint]));
      for (const sprint of rows) {
        const before = next.get(sprint.id);
        const shown = basis.sprints.find(item => item.id === sprint.id);
        if (!before && (completeReads.get("sprints") || 0) > started) continue;
        if ((stamps.get(sprint.id) || 0) > started && before?.updatedAt !== shown?.updatedAt && before?.updatedAt !== sprint.updatedAt) continue;
        next.set(sprint.id, sprint); stamps.set(sprint.id, options.nextSequence());
      }
      options.update({ ...current, sprints: [...next.values()] });
    },
    preserveLockScopes(incoming: PlanningShellState, current: PlanningShellState): Partial<PlanningShellState> {
      if(!lockedSprints.size)return {};
      const keep=<T extends {id:string|number}>(before:readonly T[],after:readonly T[],owns:(row:T)=>boolean)=>{
        const protectedRows=before.filter(owns),ids=new Set(protectedRows.map(row=>row.id));
        return [...after.filter(row=>!owns(row)&&!ids.has(row.id)),...protectedRows];
      };
      return {
        founderSprintScores:keep(current.founderSprintScores,incoming.founderSprintScores,row=>lockedSprints.has(row.sprintId)),
        strikeEvents:keep(current.strikeEvents,incoming.strikeEvents,row=>lockedSprints.has(row.sprintId)),
        founderStrikeStates:keep(current.founderStrikeStates,incoming.founderStrikeStates,row=>lockedSprints.has(row.lastEvaluatedSprintId)),
      };
    },
    schedulesPending: (id?:string) => [...pending.values()].some(entry=>!id||entry.id===id) || [...uncertain].some(key=>!id||key===id),
    readVersion: (id: string) => readStamps.get(id) || 0,
    pending: (id: string) => uncertain.has(id) || [...pending.values()].some(item => item.id === id),

    async checkPendingSchedules(): Promise<PlanningTaskSaveCheck> {
      if (!options.active()) return { outcome: "session-ended", readStatus: "not-needed" };
      const generation = options.generation();
      const unknown = [...uncertain][0];
      if (unknown) return check(unknown);
      if (pending.size) {
        await options.refresh();
        if (!options.active() || generation !== options.generation()) return { outcome: "session-ended", readStatus: "not-needed" };
        return { outcome: "unconfirmed", readStatus: options.readStatus() };
      }
      return { outcome: "not-pending", readStatus: "not-needed" };
    },
    acceptReviewWindow(result: import("@/features/sprint/model/review-window-editing").ReviewWindowConfirmation, started: number, expectedHours: number) {
      const current = options.current();
      const hours = current.project.reviewObjectionWindowHours;
      const acceptHours = (projectStamps.get("reviewObjectionWindowHours") || 0) <= started || hours === expectedHours;
      const deadlines = new Map(result.sprints.map(sprint => [sprint.id, sprint.reviewDueAt]));
      const sprints = current.sprints.map(sprint => {
        if (!deadlines.has(sprint.id) || sprint.scoreLocked || (stamps.get(sprint.id) || 0) > started) return sprint;
        stamps.set(sprint.id, options.nextSequence());
        return { ...sprint, reviewDueAt: deadlines.get(sprint.id)!, updatedAt: undefined };
      });
      if (acceptHours) projectStamps.set("reviewObjectionWindowHours", options.nextSequence());
      options.update({ ...current, sprints, project: acceptHours ? { ...current.project, reviewObjectionWindowHours: result.project.reviewObjectionWindowHours } : current.project });
    },
    reviewWindowReadVersion: () => reviewWindowReadAt,
    coverage: () => covered,
    denied: () => denied,
    readStatus(status: PlanningReadStatus) { if (status === "forbidden") denied = true; else if (status === "current" || status === "stale") denied = false; },
    project(data: PlanningShellState): PlanningShellState { return { ...data, sprints: data.sprints.map(sprint => { let value = sprint; for (const operation of pending.values()) if (operation.id === sprint.id) value = { ...value, ...operation.patch }; return value; }) }; },
    acceptRead(data: PlanningShellState, coverage: PlanningReadCoverage, started: number, returned = data) {
      covered = { ...covered, ...coverage };
      const current = options.current();
      let stale = false;
      const next = { ...data };
      const scopes = ["sprints", "founderStrikeStates", "strikeEvents", "meetings", "meetingAttendance"] as const;
      for (const key of scopes) {
        if (!coverage[key]) continue;
        if ((lockScopeAt.get(key)||0)>started) { stale=true;Object.assign(next,{[key]:current[key]});continue; }
        if ((completeReads.get(key) || 0) > started) { stale = true; Object.assign(next, { [key]: current[key] }); continue; }
        const accepted = key === "sprints" ? stamps : scopeStamps.get(key) || new Map<string | number, number>();
        scopeStamps.set(key, accepted);
        const before = current[key] as readonly { id: string | number }[];
        const incoming = returned[key] as readonly { id: string | number }[];
        const rows = new Map((coverage[key] === "partial" ? before : []).map(row => [row.id, row]));
        for (const row of incoming) if (key === "sprints" && lockedSprints.has(String(row.id)) && !(row as Sprint).scoreLocked) { stale=true; const known=current.sprints.find(sprint=>sprint.id===row.id);if(known)rows.set(row.id,known); } else if ((accepted.get(row.id) || 0) <= started) { rows.set(row.id, row); accepted.set(row.id, started); if (key === "sprints") readStamps.set(row.id, started); }
        for (const row of before) if ((accepted.get(row.id) || 0) > started) { stale = true; rows.set(row.id, row); }
        if (coverage[key] === "complete") completeReads.set(key, started);
        Object.assign(next, { [key]: [...rows.values()] });
      }
      if (coverage.project) {
        const project = { ...current.project };
        for (const key of (Object.keys(returned.project) as (keyof typeof project)[]).filter(key => key !== "githubProjectOwner" && key !== "githubProjectNumber")) if ((projectStamps.get(key) || 0) <= started) { Object.assign(project, { [key]: returned.project[key] }); projectStamps.set(key, started); if (key === "reviewObjectionWindowHours") reviewWindowReadAt = started; } else stale = true;
        next.project = project;
      }
      return { data: next, stale };
    },
    views: (id: string) => options.active() ? [...editors.values()].filter(editor => editor.id === id).map(editor => editor.view()) : [],
    begin(shown: Sprint): SprintEditor {
      let basis = structuredClone(shown);
      let closed = false;
      let view: SprintEditorView = { phase: "editing", submitted: null, serverSprint: null, error: "", canResave: false };
      const generation = options.generation();
      const context = Symbol(shown.id);
      editors.set(context, { id: shown.id, view: () => checkedView(view), releaseBlocked() { if (view.phase === "blocked") view = { ...view, phase: "editing", error: "" }; } });
      function save(patch: SprintEditPatch): Promise<SprintEditResult> {
        if (closed || !options.active() || generation !== options.generation()) return Promise.resolve({ ok: false, kind: "sessionSuperseded", error: "Die Bearbeitung wurde beendet." });
        if (options.dependencyPending?.(basis.id) || uncertain.has(basis.id) || options.reviewWindowPending?.() || options.planPending?.(basis.id) || options.lockPending?.(basis.id)) { view = { ...view, phase: "blocked", submitted: structuredClone(patch), error: "Eine vorherige Sprint-Änderung ist noch nicht bestätigt. Diese Eingabe wurde noch nicht gesendet." }; options.changed(); return Promise.resolve({ ok: false, kind: "unconfirmed", error: view.error }); }

        const operation = Symbol(basis.id);
        let originalBasis = structuredClone(basis);
        const submitted = structuredClone(patch);
        const previous = tails.get(basis.id);
        pending.set(operation, { id: basis.id, patch: submitted });
        view = { ...view, phase: "saving", submitted, error: "", canResave: false }; options.changed();
        const result = (async (): Promise<SprintEditResult> => {
          if (previous) {
            const predecessor = await previous.result;
            if (!predecessor.ok && (previous.context === context || uncertain.has(basis.id))) {
              if (uncertain.has(basis.id)) view = { ...view, phase: "blocked", error: "Die vorherige Speicherung ist noch nicht bestätigt." };
              else { pending.delete(operation); view = { ...view, phase: "rejected", error: predecessor.error }; }
              options.changed(); return predecessor;
            }
            if (predecessor.ok && previous.context === context) originalBasis = { ...originalBasis, updatedAt: predecessor.sprint.updatedAt };
          }
          if (!options.active() || generation !== options.generation()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
          try {
            if (!originalBasis.updatedAt) throw Object.assign(new Error("Lade den Sprint neu, bevor du speicherst."), { status: 400, code: "sprint_basis_missing" });
            const current = options.current().sprints.find(sprint => sprint.id === basis.id);
            if (current?.updatedAt && current.updatedAt !== originalBasis.updatedAt) throw Object.assign(new Error("Der Sprint wurde zwischenzeitlich geändert. Eingaben bleiben erhalten."), { status: 409, code: "sprint_revision_conflict" });
            if (!options.save) throw Object.assign(new Error("Sprint-Bearbeitung ist nicht verfügbar."), { status: 400 });
            const saved = await options.save(originalBasis, submitted);
            if (!options.active() || generation !== options.generation()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
            if (!saved.sprint.updatedAt || saved.sprint.id !== basis.id) throw new Error("Die Speicherung ist noch nicht bestätigt.");
            const currentAfter = options.current().sprints.find(sprint => sprint.id === basis.id);
            const foreign = currentAfter?.updatedAt !== originalBasis.updatedAt && currentAfter?.updatedAt !== saved.sprint.updatedAt;
            stamps.set(basis.id, options.nextSequence());
            if (!foreign) options.update({ ...options.current(), sprints: options.current().sprints.map(sprint => sprint.id === basis.id ? saved.sprint : sprint) });
            pending.delete(operation); basis = saved.sprint; view = { ...view, phase: "saved" }; options.changed();
            return { ok: true, sprint: saved.sprint };
          } catch (error) {
            if (!options.active() || generation !== options.generation()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
            const failure = error as { status?: number; code?: string };
            const conflict = failure.code === "sprint_revision_conflict";
            const unknown = !conflict && (failure.status === undefined || failure.status >= 500 || failure.code === "session_superseded");
            if (unknown) uncertain.add(basis.id); else pending.delete(operation);
            view = { ...view, phase: conflict ? "conflict" : unknown ? "unconfirmed" : "rejected", error: error instanceof Error ? error.message : "Sprint konnte nicht gespeichert werden." }; options.changed();
            return { ok: false, kind: conflict ? "versionConflict" : failure.code === "session_superseded" ? "sessionSuperseded" : unknown ? "unconfirmed" : "rejected", error: view.error, code: failure.code };
          }
        })();
        tails.set(basis.id, { context, result });
        void result.then(() => { if (tails.get(basis.id)?.result === result && !uncertain.has(basis.id)) tails.delete(basis.id); });
        return result;
      }
      return {
        view: () => checkedView(view), save,
        async refreshConflict() {
          if (view.phase !== "conflict" || !options.active() || generation !== options.generation()) return false;
          const started = options.nextSequence();
          const loaded = await options.refresh();
          if (!options.active() || generation !== options.generation()) return false;
          const readReturnedTarget = (readStamps.get(basis.id) || 0) > started;
          const current = readReturnedTarget ? options.current().sprints.find(sprint => sprint.id === basis.id) : undefined;
          view = { ...view, serverSprint: loaded && !denied && current ? structuredClone(current) : null, canResave: Boolean(loaded && !denied && current?.updatedAt) }; options.changed();
          return view.canResave;
        },
        resave(patch) {
          if (!view.canResave || !view.serverSprint) return Promise.resolve({ ok: false, kind: "rejected", error: "Prüfe zuerst den aktuellen Stand." });
          basis = structuredClone(view.serverSprint); return save(patch);
        },
        checkOutcome: () => check(basis.id),
        close() { closed = true; if (!view.submitted) editors.delete(context); },
      };
    },
    clear() { lockedSprints.clear();lockScopeAt.clear();pending.clear(); stamps.clear(); readStamps.clear(); editors.clear(); tails.clear(); uncertain.clear(); checks.clear(); scopeStamps.clear(); completeReads.clear(); projectStamps.clear(); denied = false; reviewWindowReadAt = 0; covered = {}; },
  };
}
