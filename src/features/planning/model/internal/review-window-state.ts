import type { PlanningShellState } from "@/lib/types";
import type { ReviewWindowConfirmation, ReviewWindowEditor, ReviewWindowEditorView, ReviewWindowResult } from "@/features/sprint/model/review-window-editing";
export function createReviewWindowState(options: {
  schedulesPending(): boolean; checkSchedules(): Promise<import("../planning-state").PlanningTaskSaveCheck>;
  active(): boolean; generation(): number; current(): PlanningShellState; nextSequence(): number; changed(): void;
  save?: (expectedHours: number, hours: number) => Promise<ReviewWindowConfirmation>;
  readVersion(): number; readStatus(): import("../planning-state").PlanningReadStatus; denied(): boolean;
  accept(result: ReviewWindowConfirmation, started: number, expectedHours: number): void; refresh(): Promise<boolean>;
}) {
  let pending: number | undefined;
  let saving = false;
  let unconfirmed = false;
  let checking: Promise<import("../planning-state").PlanningTaskSaveCheck> | undefined;
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
  const editors = new Map<symbol, { view(): ReviewWindowEditorView; handle(): ReviewWindowEditor; releaseBlocked(): void }>();
  return {
    check,
    resume(): ReviewWindowEditor | null {
      if (!options.active() || options.denied()) return null;
      const retained = [...editors.values()].reverse();
      const unknown = retained.find(editor => editor.view().phase === "unconfirmed");
      return (unknown || retained.find(editor => editor.view().submittedHours !== null && !["saved", "ended"].includes(editor.view().phase)))?.handle() || null;
    },
    blocksSprints: () => saving || unconfirmed,
    project: (data: PlanningShellState) => pending === undefined ? data : { ...data, project: { ...data.project, reviewObjectionWindowHours: pending } },
    views: () => options.active() ? [...editors.values()].map(editor => editor.view()) : [],
    begin(shownHours: number): ReviewWindowEditor {
      let basis = shownHours;
      let closed = false;
      let view: ReviewWindowEditorView = { phase: "editing", submittedHours: null, serverHours: null, error: "", canResave: false };
      const key = Symbol("review-window");
      const generation = options.generation();
      function currentView(): ReviewWindowEditorView {
        if (!options.active() || generation !== options.generation()) return { ...view, phase: "ended", submittedHours: null, serverHours: null, canResave: false };
        return options.denied() ? { ...view, submittedHours: null, serverHours: null, canResave: false } : structuredClone(view);
      }
      editors.set(key, { view: currentView, handle: () => handle, releaseBlocked() { if (view.phase === "blocked") view = { ...view, phase: "editing", error: "" }; } });
      async function save(hours: number): Promise<ReviewWindowResult> {
        if (closed || !options.active() || generation !== options.generation()) return { ok: false, kind: "sessionSuperseded", error: "Die Bearbeitung wurde beendet." };
        if (saving || unconfirmed || options.schedulesPending()) { view = { ...view, phase: "blocked", submittedHours: hours, error: "Eine vorherige Änderung am Sprint oder an der Frist ist noch nicht bestätigt. Diese Eingabe wurde noch nicht gesendet." }; options.changed(); return { ok: false, kind: "unconfirmed", error: view.error }; }
        const started = options.nextSequence();
        saving = true;
        pending = hours; view = { ...view, phase: "saving", submittedHours: hours }; options.changed();
        try {
          if (options.current().project.reviewObjectionWindowHours !== basis) throw Object.assign(new Error("Die Prozesseinstellung wurde zwischenzeitlich geändert. Eingaben bleiben erhalten."), { status: 409, code: "review_window_conflict" });
          if (!options.save) throw new Error("Die Frist kann nicht gespeichert werden.");
          const result = await options.save(basis, hours);
          if (!options.active() || generation !== options.generation()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
          options.accept(result, started, basis); basis = result.project.reviewObjectionWindowHours;
          saving = false; pending = undefined; view = { ...view, phase: "saved" }; options.changed(); void options.refresh();
          return { ok: true };
        } catch (error) {
          if (!options.active() || generation !== options.generation()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
          const failure = error && typeof error === "object" ? error as { code?: string; status?: number } : {};
          const conflict = failure.code === "review_window_conflict";
          const unknown = !conflict && (failure.status === undefined || failure.status >= 500 || failure.code === "session_superseded");
          saving = false; unconfirmed = unknown;
          if (!unknown) pending = undefined;
          view = { ...view, phase: conflict ? "conflict" : unknown ? "unconfirmed" : "rejected", canResave: false, serverHours: null, error: error instanceof Error ? error.message : "Die Frist konnte nicht gespeichert werden." }; options.changed();
          return { ok: false, kind: conflict ? "versionConflict" : failure.code === "session_superseded" ? "sessionSuperseded" : unknown ? "unconfirmed" : "rejected", error: view.error, code: failure.code };
        }
      }
      const handle: ReviewWindowEditor = { view: currentView, save,
        async refreshConflict() {
          if (view.phase !== "conflict" || !options.active() || generation !== options.generation()) return false;
          const started = options.nextSequence();
          const loaded = await options.refresh();
          if (!options.active() || generation !== options.generation()) return false;
          const accepted = loaded && !options.denied() && options.readVersion() > started;
          view = { ...view, serverHours: accepted ? options.current().project.reviewObjectionWindowHours : null, canResave: accepted }; options.changed();
          return accepted;
        },
        resave(hours) { if (!view.canResave || view.serverHours === null) return Promise.resolve({ ok: false, kind: "rejected", error: "Vergleiche zuerst die Änderungen." }); basis = view.serverHours; return save(hours); },
        checkOutcome: check,
        close() { if (view.submittedHours === null) { closed = true; editors.delete(key); } },
      };
      return handle;
    },
    clear() { pending = undefined; saving = false; unconfirmed = false; checking = undefined; editors.clear(); },
  };
}
