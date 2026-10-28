import type { PlanningShellState, Sprint, Task } from "@/lib/types";
import type { BacklogAssignmentAdapter, BacklogAssignmentEditor, BacklogAssignmentView, BacklogAssignmentResult } from "@/features/backlog/model/backlog-assignment";
import { getBacklogSprintAssignmentEligibility, backlogSprintAssignmentMessage } from "@/features/backlog/model/backlog-planning-state";
export function createBacklogAssignments(options: {
 current(): PlanningShellState; active(): boolean; generation(): number; canRead(): boolean; changed(): void; nextSequence(): number;
 readTaskVersion(id: string): number; readSprintVersion(id: string): number;
 pendingTask(id: string): boolean; pendingSprint(id: string): boolean; refresh(): Promise<boolean>; adapter: BacklogAssignmentAdapter;
 accept(updates: Partial<Task>[], started: number, basis: readonly Task[], activities?: import("@/lib/types").TaskActivity[]): void; invalidateDependencies(unknown: boolean): void; endSession(): void;
}) {
 const retained = new Map<string, { editor: BacklogAssignmentEditor; view: BacklogAssignmentView; sprints: Sprint[]; generation: number; authority: number }>();
 let nextId = 0, authority = 0;
 const unresolved = (view: BacklogAssignmentView) => view.phase === "saving" || view.phase === "unconfirmed";
 const blocksTask = (id: string) => [...retained.values()].some(item => unresolved(item.view) && item.view.tasks.some(task => task.id === id));
 const blocksSprint = (id: string) => [...retained.values()].some(item => unresolved(item.view) && (item.view.targetSprint?.id === id || item.view.tasks.some(task => task.sprintId === id)));
 function begin(shown: readonly Task[], shownSprints: readonly Sprint[], bulk: boolean): BacklogAssignmentEditor {
   let tasks = structuredClone([...shown]), sprints = structuredClone([...shownSprints]);
   const generation = options.generation(), scope = authority, id = `assignment:${++nextId}`;
   let view: BacklogAssignmentView = { id, phase: "editing", tasks, targetSprint: null, serverTasks: [], serverSprints: [], error: "", confirmedTaskIds: [], canResave: false, checking: false };
   let checking: Promise<boolean> | undefined;
   let compared: { tasks: Task[]; sprints: Sprint[] } | null = null;
   const valid = () => options.active() && generation === options.generation() && scope === authority && options.canRead();
   const result = (phase: BacklogAssignmentResult["phase"], error = view.error): BacklogAssignmentResult => ({ phase, confirmedCount: view.confirmedTaskIds.length, error });
   async function assign(sprintId: string | null): Promise<BacklogAssignmentResult> {
     if (!valid()) return result("ended");
     if (unresolved(view) || view.phase === "saved") return result(view.phase === "saved" ? "saved" : "unconfirmed");
     if (view.phase === "conflict") return result("conflict");
     const target = sprintId ? sprints.find(sprint => sprint.id === sprintId) : null;
     view = { ...view, tasks, targetSprint: target || null, canResave: false, confirmedTaskIds: [] };
     retained.set(id, { editor, view, sprints, generation, authority: scope });
     function finish(phase: BacklogAssignmentResult["phase"], error = "") { view = { ...view, phase, error }; retained.get(id)!.view = view; if (phase === "saved" || phase === "rejected") retained.delete(id); if (phase === "saved" || phase === "unconfirmed") options.invalidateDependencies(phase === "unconfirmed"); options.changed(); return result(phase); }
     if (!tasks.length || tasks.length > (bulk ? 100 : 1) || tasks.some(task => !task.updatedAt) || new Set(tasks.map(task => task.id)).size !== tasks.length || (sprintId && (!target || !target.updatedAt)) || (bulk && !target)) return finish("rejected", "Die angezeigte Aufgaben- oder Sprint-Version fehlt. Bitte neu laden.");
     const related = [...new Set([target?.id, ...tasks.map(task => task.sprintId)].filter((value): value is string => Boolean(value)))];
     if (tasks.some(task => blocksTask(task.id) || options.pendingTask(task.id)) || related.some(sprint => blocksSprint(sprint) || options.pendingSprint(sprint))) return finish("blocked", "Eine Änderung derselben Aufgabe oder desselben Sprints ist noch nicht bestätigt. Diese Zuordnung wurde nicht gesendet.");
     for (const task of tasks) {
       const eligibility = getBacklogSprintAssignmentEligibility(task, target || null, { sourceSprintLocked: Boolean(sprints.find(sprint => sprint.id === task.sprintId)?.scoreLocked) });
       if (!eligibility.ok) return finish("rejected", backlogSprintAssignmentMessage(eligibility.reason));
       const current = options.current().tasks.find(item => item.id === task.id);
       if (!current || current.updatedAt !== task.updatedAt) return finish("conflict", "Eine angezeigte Aufgabe wurde geändert. Eingaben bleiben erhalten.");
     }
     for (const sprintId of related) {
       const before = sprints.find(sprint => sprint.id === sprintId), current = options.current().sprints.find(sprint => sprint.id === sprintId);
       if (!before || !current || before.updatedAt !== current.updatedAt) return finish("conflict", "Ein angezeigter Sprint wurde geändert. Bitte den aktuellen Serverstand prüfen.");
     }
     if (!options.adapter.assignBacklog) return finish("rejected", "Sprint-Zuordnung ist nicht verfügbar.");
     view = { ...view, phase: "saving", error: "" }; retained.get(id)!.view = view; const started = options.nextSequence(); options.changed();
     try {
       const receipt = await options.adapter.assignBacklog(tasks, target || null, bulk);
       if (!valid()) return result("ended");
       const ids = new Set(tasks.map(task => task.id)), seen = new Set<string>();
       const updates = (Array.isArray(receipt.updates) ? receipt.updates : []).filter(update => {
         if (!update.id || !ids.has(update.id) || seen.has(update.id) || !update.updatedAt || typeof update.sprintId !== "string" || typeof update.scoreRelevant !== "boolean") return false;
         seen.add(update.id); return true;
       });
       if (updates.length) options.accept(updates, started, tasks, receipt.activities);
       view = { ...view, confirmedTaskIds: updates.filter(update => update.sprintId === (target?.id || "")).map(update => update.id!) }; retained.get(id)!.view = view;
       if (updates.length !== tasks.length || receipt.updates.length !== tasks.length || view.confirmedTaskIds.length !== tasks.length) return finish("unconfirmed", "Nur ein Teil der Zuordnung ist bestätigt. Bitte den Serverstand prüfen; nicht erneut zuordnen.");
       return finish("saved");
     } catch (error) {
       if (!valid()) return result("ended");
       const failure = error as { status?: number; code?: string; kind?: string; message?: string };
       if (failure.code === "session_superseded") { options.endSession(); return result("ended"); }
       const conflict = failure.kind === "versionConflict" || failure.code === "sprint_revision_conflict" || failure.code === "task_revision_conflict";
       return finish(conflict ? "conflict" : failure.status && failure.status < 500 ? "rejected" : "unconfirmed", failure.message || "Die Zuordnung ist noch nicht bestätigt.");
     }
   }
   const editor: BacklogAssignmentEditor = {
     view: () => valid() ? structuredClone(view) : { ...view, phase: "ended", tasks: [], targetSprint: null, serverTasks: [], serverSprints: [], confirmedTaskIds: [], canResave: false }, assign,
     checkOutcome() {
       if (checking) return checking;
       if (!valid()) return Promise.resolve(false);
       view = { ...view, checking: true }; if (retained.has(id)) retained.get(id)!.view = view; options.changed();
       const started = options.nextSequence();
       checking = (async () => { const ok = await options.refresh(); if (!valid()) return false; const current = options.current(); view = { ...view, checking: false, serverTasks: ok ? current.tasks.filter(task => tasks.some(shown => shown.id === task.id) && options.readTaskVersion(task.id) > started) : [], serverSprints: ok ? current.sprints.filter(sprint => (sprint.id === view.targetSprint?.id || tasks.some(task => task.sprintId === sprint.id)) && options.readSprintVersion(sprint.id) > started) : [] }; if (retained.has(id)) retained.get(id)!.view = view; options.changed(); return ok; })();
       void checking.finally(() => { checking = undefined; }); return checking;
     },
     async refreshConflict() {
       if (!valid() || view.phase !== "conflict") return false;
       const started = options.nextSequence(); if (!(await editor.checkOutcome())) return false;
       const current = options.current(), serverTasks = tasks.map(task => current.tasks.find(item => item.id === task.id));
       if (serverTasks.some(task => !task?.updatedAt || options.readTaskVersion(task.id) <= started) || (view.targetSprint && (!current.sprints.find(sprint => sprint.id === view.targetSprint!.id)?.updatedAt || options.readSprintVersion(view.targetSprint.id) <= started))) return false;
       const requiredSprints = [...new Set([view.targetSprint?.id, ...serverTasks.map(task => task?.sprintId)].filter((id): id is string => Boolean(id)))];
       if (requiredSprints.some(id => options.readSprintVersion(id) <= started)) return false;
       compared = { tasks: structuredClone(serverTasks as Task[]), sprints: structuredClone(current.sprints) };
       view = { ...view, canResave: true }; retained.get(id)!.view = view; options.changed(); return true;
     },
     resave() { if (!valid() || !view.canResave || !compared) return Promise.resolve(result("rejected", "Bitte zuerst den aktuellen Serverstand prüfen.")); tasks = compared.tasks; sprints = compared.sprints; const targetId = view.targetSprint?.id || null; view = { ...view, phase: "editing", canResave: false }; return assign(targetId); },
   }; return editor;
 }
 return { begin, blocksTask, blocksSprint,
   checkTask: (id: string) => [...retained.values()].find(item => unresolved(item.view) && item.view.tasks.some(task => task.id === id))?.editor.checkOutcome() || Promise.resolve(false),
   checkSprint: (id: string) => [...retained.values()].find(item => unresolved(item.view) && (item.view.targetSprint?.id === id || item.view.tasks.some(task => task.sprintId === id)))?.editor.checkOutcome() || Promise.resolve(false),
   saveStatus: (id: string): "saving" | "unconfirmed" | undefined => [...retained.values()].find(item => unresolved(item.view) && item.view.tasks.some(task => task.id === id))?.view.phase as "saving" | "unconfirmed" | undefined,
 pending: () => [...retained.values()].some(item => unresolved(item.view)), views: () => [...retained.values()].map(item => item.editor.view()).filter(view => view.phase !== "ended"), resume: (id: string) => retained.get(id)?.editor || null,
   project(data: PlanningShellState): PlanningShellState { if (!options.active()) return data; return { ...data, tasks: data.tasks.map(task => { let value = task; for (const item of retained.values()) if (unresolved(item.view) && !item.view.confirmedTaskIds.includes(task.id) && item.view.tasks.some(before => before.id === task.id)) value = { ...value, sprintId: item.view.targetSprint?.id || "", scoreRelevant: Boolean(item.view.targetSprint) }; return value; }) }; },
   denied() { authority++; retained.clear(); }, clear() { authority++; retained.clear(); },
 };
}
