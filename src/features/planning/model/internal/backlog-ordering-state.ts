import type { PlanningShellState, Task } from "@/lib/types";
import type { BacklogOrderEditor, BacklogOrderingAdapter, BacklogOrderPatch, BacklogOrderResult, BacklogOrderView, BacklogPlacement } from "@/features/backlog/model/backlog-ordering";
function eligible(task: Task) { return task.taskType === "deliverable" && task.status !== "Erledigt" && !task.trashedAt; }
export function createBacklogOrdering(options: {
  current(): PlanningShellState; active(): boolean; generation(): number; canRead(): boolean; changed(): void; nextSequence(): number; readVersion(id: string): number;
  adapter: BacklogOrderingAdapter; pendingTask(id: string): boolean; refresh(): Promise<boolean>; endSession(): void;
  accept(updates: BacklogOrderPatch[], started: number, basis: readonly Task[]): boolean; invalidate(unknown: boolean): void;
}) {
  let nextId = 0, authority = 0, boundary = 0;
  const retained = new Map<string, { editor: BacklogOrderEditor; view: BacklogOrderView; orders: Map<string, number> }>();
  let reading: { boundary: number; promise: Promise<{ ok: boolean; started: number }> } | undefined;
  const unresolved = (view: BacklogOrderView) => view.phase === "saving" || view.phase === "unconfirmed";
  const pending = () => [...retained.values()].some(item => unresolved(item.view));
  const blocksTask = (id: string) => pending() && Boolean(options.current().tasks.some(task => task.id === id && eligible(task)) || [...retained.values()].some(item => unresolved(item.view) && (item.view.source?.id === id || item.view.target?.id === id)));
  function refresh() {
    if (reading && reading.boundary >= boundary) return reading.promise;
    const started = options.nextSequence(); const promise = options.refresh().then(ok => ({ ok, started })); reading = { boundary, promise }; void promise.finally(() => { if (reading?.promise === promise) reading = undefined; }); return promise;
  }
  function begin(shown: readonly Task[]): BacklogOrderEditor {
    let basis = structuredClone([...shown]); const generation = options.generation(), scope = authority, id = `order:${++nextId}`;
    let view: BacklogOrderView = { id, phase: "editing", source: null, target: null, placement: "before", error: "", checking: false, canResave: false, serverTasks: [], confirmedIds: [] };
    let compared: Task[] | undefined;
    const valid = () => options.active() && generation === options.generation() && scope === authority && options.canRead();
    const result = (phase: BacklogOrderResult["phase"], error = view.error): BacklogOrderResult => ({ phase, affectedCount: view.confirmedIds.length, error });
    const publish = () => { const item = retained.get(id); if (item) item.view = view; options.changed(); };
    async function move(taskId: string, targetTaskId: string, placement: BacklogPlacement): Promise<BacklogOrderResult> {
      if (!valid()) return result("ended");
      if (view.phase === "saving" || view.phase === "unconfirmed") return result("unconfirmed");
      if (view.phase === "saved" || view.phase === "conflict") return result(view.phase);
      const source = basis.find(task => task.id === taskId), target = basis.find(task => task.id === targetTaskId);
      view = { ...view, source: source || null, target: target || null, placement, canResave: false, serverTasks: [], confirmedIds: [] };
      retained.set(id, { editor, view, orders: new Map() });
      function finish(phase: BacklogOrderResult["phase"], error = "") {
        view = { ...view, phase, error }; retained.get(id)!.view = view;
        if (phase === "saved" || phase === "rejected") retained.delete(id);
        if (phase === "unconfirmed") options.invalidate(true);
        publish(); return result(phase);
      }
      if (!source || !target || source.id === target.id || !source.updatedAt || !target.updatedAt || !eligible(source) || !eligible(target) || !["before","after"].includes(placement)) return finish("rejected", "Die angezeigte Backlog-Verschiebung ist nicht gültig. Bitte neu laden.");
      if ([...retained.values()].some(item => item.view.id !== id && unresolved(item.view)) || options.current().tasks.some(task => eligible(task) && options.pendingTask(task.id))) return finish("blocked", "Eine Änderung im betroffenen Backlog ist noch nicht bestätigt. Diese Verschiebung wurde noch nicht ausgeführt.");
      for (const task of [source,target]) if (options.current().tasks.find(current => current.id === task.id)?.updatedAt !== task.updatedAt) return finish("conflict", "Quelle oder Ziel wurde zwischenzeitlich geändert. Deine gewünschte Reihenfolge bleibt erhalten.");
      if (!options.adapter.moveBacklog) return finish("rejected", "Backlog-Verschiebung ist nicht verfügbar.");
      const rows = basis.filter(eligible).sort((a,b) => a.order - b.order || a.id.localeCompare(b.id));
      const remaining = rows.filter(task => task.id !== source.id), targetIndex = remaining.findIndex(task => task.id === target.id), insert = targetIndex + (placement === "after" ? 1 : 0);
      const order = [...remaining.slice(0,insert), source, ...remaining.slice(insert)];
      retained.get(id)!.orders = new Map(order.filter((task,index) => task.order !== (index + 1)*10).map(task => [task.id, (order.findIndex(row => row.id === task.id)+1)*10]));
      view = { ...view, phase: "saving", error: "" }; boundary++; const started = options.nextSequence(); publish();
      try {
        const receipt = await options.adapter.moveBacklog(source,target,placement); if (!valid()) return result("ended");
        const seen = new Set<string>(), duplicates = new Set<string>(); let malformed = !Array.isArray(receipt.updates);
        for (const update of Array.isArray(receipt.updates) ? receipt.updates : []) { if (update && seen.has(update.id)) duplicates.add(update.id); if (update) seen.add(update.id); }
        const updates = (Array.isArray(receipt.updates) ? receipt.updates : []).filter(update => {
          const ok = Boolean(update && typeof update.id === "string" && update.id && !duplicates.has(update.id) && typeof update.sortOrder === "number" && Number.isFinite(update.sortOrder) && typeof update.updatedAt === "string" && update.updatedAt);
          if (!ok) malformed = true; return ok;
        });
        const unresolvedMembership = updates.length ? options.accept(updates,started,basis) : false;
        view = { ...view, confirmedIds: updates.map(update => update.id) }; retained.get(id)!.view = view; boundary++;
        if (unresolvedMembership) { options.invalidate(false); void refresh(); }
        return malformed || receipt.completeness !== "complete" ? finish("unconfirmed", view.confirmedIds.length ? "Ein Teil der Reihenfolge ist gespeichert. Für den Rest ist das noch unklar. Bitte prüfen und nicht erneut verschieben." : "Ob die Reihenfolge gespeichert wurde, ist noch unklar. Bitte prüfen und nicht erneut verschieben.") : finish("saved");
      } catch (error) {
        if (!valid()) return result("ended");
        const failure = error as { status?: number; code?: string; message?: string };
        if (failure.code === "session_superseded") { options.endSession(); return result("ended"); }
        const phase = failure.code === "backlog_order_revision_conflict" ? "conflict" : failure.status && failure.status < 500 ? "rejected" : "unconfirmed";
        boundary++; return finish(phase, failure.message || "Die Rangfolge ist noch nicht bestätigt.");
      }
    }
    const editor: BacklogOrderEditor = {
      view: () => valid() ? structuredClone(view) : { ...view, phase: "ended", source: null, target: null, serverTasks: [], confirmedIds: [], canResave: false }, move,
      async checkOutcome() {
        if (!valid()) return false; view = { ...view, checking: true }; publish(); const { ok, started } = await refresh(); if (!valid()) return false;
        view = { ...view, checking: false, serverTasks: ok ? options.current().tasks.filter(task => (task.id === view.source?.id || task.id === view.target?.id) && options.readVersion(task.id) > started) : [] }; publish(); return ok;
      },
      async refreshConflict() {
        if (!valid() || view.phase !== "conflict" || !(await editor.checkOutcome()) || view.serverTasks.length !== 2) return false;
        compared = structuredClone(options.current().tasks); view = { ...view, canResave: true }; publish(); return true;
      },
      resave() { if (!valid() || !view.canResave || !compared || !view.source || !view.target) return Promise.resolve(result("rejected", "Prüfe zuerst die betroffenen Aufgaben.")); basis = compared; const source = view.source.id, target = view.target.id; view = { ...view, phase: "editing", canResave: false }; return move(source,target,view.placement); },
    }; return editor;
  }
  return { begin, pending, blocksTask, views: () => [...retained.values()].map(item => item.editor.view()).filter(view => view.phase !== "ended"), resume: (id: string) => retained.get(id)?.editor || null,
    checkTask: (id: string) => blocksTask(id) ? [...retained.values()].find(item => unresolved(item.view))?.editor.checkOutcome() || Promise.resolve(false) : Promise.resolve(false),
    saveStatus: (id: string): "saving" | "unconfirmed" | undefined => blocksTask(id) ? [...retained.values()].find(item => unresolved(item.view))!.view.phase as "saving" | "unconfirmed" : undefined,
    project(data: PlanningShellState): PlanningShellState { return { ...data, tasks: data.tasks.map(task => { let value = task; for (const item of retained.values()) if (unresolved(item.view) && item.orders.has(task.id) && !item.view.confirmedIds.includes(task.id)) value = { ...value, order: item.orders.get(task.id)! }; return value; }) }; },
    denied() { authority++; retained.clear(); reading = undefined; }, clear() { authority++; retained.clear(); reading = undefined; },
  };
}
