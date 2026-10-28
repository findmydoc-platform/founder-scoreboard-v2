import type { Task } from "@/lib/types";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";
import type { PlanningTaskEditor, PlanningTaskEditorView, PlanningTaskSaveCheck } from "../planning-state";

type EditingAdapter = {
  currentTask(taskId: string): Task | null;
  saveTask(task: Task, patch: Partial<Task>, context: symbol): Promise<TaskUpdateResult>;
  checkOutcome(taskId: string): Promise<PlanningTaskSaveCheck>;
  reload(taskId: string): Promise<{ ok: boolean }>;
  generation(): number;
  isActive(): boolean;
  canReadTask(taskId: string): boolean;
  changed(): void;
};

export function createTaskEditing(adapter: EditingAdapter) {
  const retained = new Map<symbol, { taskId: string; editor: PlanningTaskEditor }>();
  return {
    views: (taskId: string) => [...retained.values()].filter(item => item.taskId === taskId).map(item => item.editor.view()),
    clear: () => retained.clear(),
    begin(task: Task | string): PlanningTaskEditor {
      const taskId = typeof task === "string" ? task : task.id;
      const context = Symbol(taskId);
      const generation = adapter.generation();
      const openedTask = typeof task === "string" ? adapter.currentTask(taskId) : task;
      let basis = openedTask ? { ...openedTask } : null;
      let conflictBasis: Task | null = null;
      let phase: PlanningTaskEditorView["phase"] = "editing";
      let submitted: Partial<Task> | null = null;
      let error = "";
      let closed = false;
      let saves = 0;
      const sameSession = () => adapter.isActive() && adapter.generation() === generation;
      const current = () => !closed && sameSession();
      const blocked = (): TaskUpdateResult => ({ ok: false, kind: current() ? (phase === "unconfirmed" || phase === "blocked") ? "unconfirmed" : "versionConflict" : "sessionSuperseded", error: current() ? error || "Bitte den aktuellen Stand prüfen und bewusst erneut speichern." : "Die Sitzung wurde ersetzt.", status: 409 });
      async function save(patch: Partial<Task>): Promise<TaskUpdateResult> {
        if (!current()) return blocked();
        if (phase === "conflict" || phase === "unconfirmed" || phase === "blocked") return blocked();
        if (!basis) return { ok: false, kind: "rejected", error: "Aufgabe wurde nicht gefunden.", status: 404 };
        submitted = structuredClone(patch);
        retained.set(context, { taskId, editor });
        saves++;
        phase = "saving";
        error = "";
        const result = await adapter.saveTask(basis, submitted, context);
        saves--;
        if (!sameSession()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
        if (result.ok) {
          basis = { ...basis, ...result.task };
          phase = saves ? "saving" : "saved";
        } else {
          error = result.error;
          if (result.kind === "versionConflict") {
            phase = "conflict";
            conflictBasis = null;
            try {
              if ((await adapter.reload(taskId)).ok && sameSession()) {
                const latest = adapter.currentTask(taskId);
                conflictBasis = latest ? { ...latest } : null;
              }
            } catch { /* Keep the draft; resaving needs a successful authorized read. */ }
          } else if (result.kind === "sessionSuperseded") {
            phase = "unconfirmed";
          } else if (result.kind === "authorityEnded") {
            phase = "ended";
            closed = true;
          } else phase = result.kind === "unconfirmed" ? result.code === "predecessor_unconfirmed" ? "blocked" : "unconfirmed" : "rejected";
        }
        if (closed && (phase === "saved" || phase === "rejected")) retained.delete(context);
        adapter.changed();
        return result;
      }
      const editor: PlanningTaskEditor = {
        view: () => sameSession()
          ? { phase, submitted: adapter.canReadTask(taskId) ? submitted : null, serverTask: adapter.canReadTask(taskId) ? conflictBasis || adapter.currentTask(taskId) : null, error, canResave: current() && adapter.canReadTask(taskId) && phase === "conflict" && Boolean(conflictBasis?.updatedAt) }
          : { phase: "ended", submitted: null, serverTask: null, error: "Die Sitzung wurde ersetzt.", canResave: false },
        save,
        async refreshConflict() {
          if (!current() || phase !== "conflict") return false;
          try {
            if (!(await adapter.reload(taskId)).ok || !current()) return false;
            const latest = adapter.currentTask(taskId);
            conflictBasis = latest ? { ...latest } : null;
            adapter.changed();
            return Boolean(conflictBasis?.updatedAt);
          } catch { return false; }
        },
        resave(patch) {
          if (!current() || !adapter.canReadTask(taskId) || phase !== "conflict" || !conflictBasis?.updatedAt) return Promise.resolve(blocked());
          basis = { ...conflictBasis };
          conflictBasis = null;
          phase = "editing";
          return save(patch);
        },
        checkOutcome: () => sameSession() ? adapter.checkOutcome(taskId) : Promise.resolve({ outcome: "session-ended", readStatus: "not-needed" }),
        close() { closed = true; if (!submitted || phase === "saved" || phase === "rejected") retained.delete(context); },
      };
      return editor;
    },
  };
}
