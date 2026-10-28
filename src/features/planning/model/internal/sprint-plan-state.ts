import type { PlanningShellState, Sprint } from "@/lib/types";
import { futureSprintDrafts } from "../planning-app-model";
import type { SprintPlanningOptions } from "@/features/sprint/model/sprint-planning-options";
import type { SprintPlanBasis, SprintPlanConfirmation, SprintPlanEditor, SprintPlanEditorView, SprintPlanResult } from "@/features/sprint/model/sprint-plan";
export function createSprintPlanState(options: {
  schedulesPending(): boolean; checkSchedules(): Promise<import("../planning-state").PlanningTaskSaveCheck>;
  denied(): boolean; readStatus(): import("../planning-state").PlanningReadStatus;
  current(): PlanningShellState; active(): boolean; generation(): number; changed(): void; nextSequence(): number; refresh(): Promise<boolean>;
  create?: (input: SprintPlanningOptions, basis: SprintPlanBasis) => Promise<SprintPlanConfirmation>;
  accept(rows: Sprint[], started: number, basis: SprintPlanBasis): void;
}) {
  let provisional: Sprint[] = [];
  let saving = false;
  let unconfirmed = false;
  let activeBasis: SprintPlanBasis | undefined;
  let checking: Promise<import("../planning-state").PlanningTaskSaveCheck> | undefined;
  function visibleDrafts(data: PlanningShellState) {
    return provisional.filter(draft => {
      const current = data.sprints.find(sprint => sprint.id === draft.id);
      const shown = activeBasis?.sprints.find(sprint => sprint.id === draft.id);
      if (current?.scoreLocked || data.tasks.some(task => task.sprintId === draft.id)) return false;
      return current ? Boolean(shown && current.updatedAt === shown.updatedAt) : !shown;
    });
  }
  function check(): Promise<import("../planning-state").PlanningTaskSaveCheck> {
    if (!options.active()) return Promise.resolve({ outcome: "session-ended", readStatus: "not-needed" });
    if (!unconfirmed) {
      if (options.schedulesPending()) return options.checkSchedules();
      if (saving) return Promise.resolve({ outcome: "unconfirmed", readStatus: "not-needed" });
      for (const editor of editors.values()) editor.releaseBlocked();
      options.changed();
      return Promise.resolve({ outcome: "not-pending", readStatus: "not-needed" });
    }
    if (checking) return checking;
    const generation = options.generation();
    const checked = (async (): Promise<import("../planning-state").PlanningTaskSaveCheck> => {
      await options.refresh();
      if (!options.active() || generation !== options.generation()) return { outcome: "session-ended", readStatus: "not-needed" };
      return { outcome: "unconfirmed", readStatus: options.readStatus() };
    })();
    checking = checked;
    void checked.finally(() => { if (checking === checked) checking = undefined; });
    return checked;
  }
  const editors = new Map<symbol, { view(): SprintPlanEditorView; handle(): SprintPlanEditor; releaseBlocked(): void }>();
  return {
    check,
    blocksSchedules: () => saving || unconfirmed,
    blocksSprint: (id: string) => (saving || unconfirmed) && provisional.some(row => row.id === id),
    resume(): SprintPlanEditor | null {
      if (!options.active() || options.denied()) return null;
      const retained = [...editors.values()].reverse();
      return (retained.find(editor => editor.view().phase === "unconfirmed") || retained.find(editor => editor.view().submitted && !["saved", "ended"].includes(editor.view().phase)))?.handle() || null;
    },
    project(data: PlanningShellState): PlanningShellState {
      const drafts = visibleDrafts(data);
      const replacements = new Map(drafts.map(sprint => [sprint.id, sprint]));
      const known = new Set(data.sprints.map(sprint => sprint.id));
      return { ...data, sprints: [...data.sprints.map(sprint => { const draft = replacements.get(sprint.id); return draft ? { ...sprint, name: draft.name, startDate: draft.startDate, endDate: draft.endDate, reviewDueAt: draft.reviewDueAt } : sprint; }), ...drafts.filter(sprint => !known.has(sprint.id))] };
    },
    view: () => ({ provisionalSprintIds: options.active() && !options.denied() ? visibleDrafts(options.current()).map(sprint => sprint.id) : [], edits: options.active() ? [...editors.values()].map(editor => editor.view()) : [] }),
    begin(): SprintPlanEditor {
      const data = options.current();
      let basis: SprintPlanBasis = { sprints: structuredClone(data.sprints), reviewObjectionWindowHours: data.project.reviewObjectionWindowHours };
      let view: SprintPlanEditorView = { phase: "editing", submitted: null, error: "", changedCount: null, canRecreate: false, serverSprints: null };
      const key = Symbol("plan");
      const generation = options.generation();
      let closed = false;
      function currentView(): SprintPlanEditorView {
        if (!options.active() || generation !== options.generation()) return { ...view, phase: "ended", submitted: null, serverSprints: null, canRecreate: false };
        return options.denied() ? { ...view, submitted: null, serverSprints: null, canRecreate: false } : structuredClone(view);
      }
      editors.set(key, { view: currentView, handle: () => handle, releaseBlocked() { if (view.phase === "blocked") view = { ...view, phase: "editing", error: "" }; } });
      async function create(input: SprintPlanningOptions): Promise<SprintPlanResult> {
        if (closed || !options.active() || generation !== options.generation()) return { ok: false, kind: "sessionSuperseded", error: "Die Bearbeitung wurde beendet." };
        if (options.denied()) return { ok: false, kind: "rejected", error: "Kein Zugriff auf diesen Sprint-Bereich." };
        if (saving || unconfirmed || options.schedulesPending()) { view = { ...view, phase: "blocked", submitted: structuredClone(input), error: "Ein vorheriger Sprint-Plan ist noch nicht bestätigt. Diese Planung wurde noch nicht gesendet." }; options.changed(); return { ok: false, kind: "unconfirmed", error: view.error }; }
        saving = true; activeBasis = basis;
        const started = options.nextSequence();
        const protectedIds = new Set(options.current().tasks.filter(task => task.sprintId).map(task => task.sprintId));
        provisional = futureSprintDrafts([...basis.sprints], input, protectedIds, basis.reviewObjectionWindowHours).map(sprint => ({ ...sprint, updatedAt: undefined }));
        view = { ...view, phase: "saving", submitted: structuredClone(input) }; options.changed();
        try {
          if (!options.create) throw Object.assign(new Error("Sprint-Planung ist nicht verfügbar."), { status: 400 });
          const result = await options.create(input, basis);
          if (!options.active() || generation !== options.generation()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
          if (result.sprints.some(sprint => !sprint.updatedAt)) throw new Error("Der Sprint-Plan ist noch nicht bestätigt.");
          options.accept(result.sprints, started, basis);
          saving = false; provisional = []; view = { ...view, phase: "saved", changedCount: result.sprints.length }; options.changed(); void options.refresh();
          return { ok: true, changedCount: result.sprints.length };
        } catch (error) {
          if (!options.active() || generation !== options.generation()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
          const failure = error && typeof error === "object" ? error as { status?: number; code?: string } : {};
          const mixedConflict = failure.code === "sprint_plan_changed_or_protected";
          const conflict = failure.code === "sprint_plan_conflict" || mixedConflict;
          const unknown = !conflict && (failure.status === undefined || failure.status >= 500 || failure.code === "session_superseded");
          saving = false; unconfirmed = unknown;
          if (!unknown) provisional = [];
          view = { ...view, phase: conflict ? "conflict" : unknown ? "unconfirmed" : "rejected", canRecreate: false, serverSprints: null, error: error instanceof Error ? error.message : "Sprint-Plan konnte nicht gespeichert werden." }; options.changed();
          return { ok: false, kind: mixedConflict ? "planChangedOrProtected" : conflict ? "versionConflict" : failure.code === "session_superseded" ? "sessionSuperseded" : unknown ? "unconfirmed" : "rejected", error: view.error, code: failure.code };
        }
      }
      const handle: SprintPlanEditor = { view: currentView, create, async refreshConflict() {
        if (view.phase !== "conflict" || !options.active() || generation !== options.generation()) return false;
        const loaded = await options.refresh();
        if (!options.active() || generation !== options.generation()) return false;
        const accepted = loaded && !options.denied() && options.readStatus() === "current";
        view = { ...view, serverSprints: accepted ? structuredClone(options.current().sprints) : null, canRecreate: accepted };
        options.changed(); return accepted;
      }, recreate(input) {
        if (!view.canRecreate || !view.serverSprints) return Promise.resolve({ ok: false, kind: "rejected", error: "Bitte zuerst den Serverstand vergleichen." });
        basis = { sprints: structuredClone(view.serverSprints), reviewObjectionWindowHours: options.current().project.reviewObjectionWindowHours };
        return create(input);
      }, checkOutcome: check, close() { if (!view.submitted) { closed = true; editors.delete(key); } } };
      return handle;
    },
    clear() { provisional = []; editors.clear(); saving = false; unconfirmed = false; checking = undefined; activeBasis = undefined; },
  };
}
