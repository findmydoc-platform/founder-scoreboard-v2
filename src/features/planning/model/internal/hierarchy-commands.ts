import type { Task } from "@/lib/types";
import type { EpicDraft, InitiativeDraft, HierarchyEditor, HierarchyEditView, HierarchySaveResult } from "@/features/projects/model/hierarchy-state";
import type { PlanningState } from "../planning-state";

const hierarchyStatus = (status: string) => status === "active" ? "In Arbeit" : status === "done" ? "Erledigt" : status === "paused" ? "Pausiert" : "Offen";
function epicPatch(draft: EpicDraft): Partial<Task> {
  return { title: draft.title, description: draft.description, targetDate: draft.targetDate, status: hierarchyStatus(draft.status) };
}
function initiativePatch(draft: InitiativeDraft): Partial<Task> {
  return { title: draft.title, description: draft.goal, ownerId: draft.ownerId, priority: draft.priority, status: hierarchyStatus(draft.status), targetDate: draft.targetDate,
    strategy: { goal: draft.goal, successCriteria: draft.successCriteria, scopeConstraints: draft.scopeConstraints },
    raciAssignments: [{ profileId: draft.accountableProfileId, role: "accountable", sortOrder: 0 },
      ...draft.responsibleProfileIds.map((profileId, sortOrder) => ({ profileId, role: "responsible" as const, sortOrder })),
      ...draft.consultedProfileIds.map((profileId, sortOrder) => ({ profileId, role: "consulted" as const, sortOrder })),
      ...draft.informedProfileIds.map((profileId, sortOrder) => ({ profileId, role: "informed" as const, sortOrder }))] };
}
export function createHierarchyCommands(options: { planning(): PlanningState; currentTask(id: string): Task | undefined; active(): boolean; generation(): number; changed(): void }) {
  let sequence = 0;
  const retained = new Map<string, { view(): HierarchyEditView; check: HierarchyEditor<EpicDraft>["checkOutcome"] }>();
  function begin<Draft extends EpicDraft | InitiativeDraft>(kind: "epic" | "initiative", basis: Pick<Draft, "id" | "expectedUpdatedAt" | "creationRequestId">): HierarchyEditor<Draft> {
    const taskId = basis.id, creationId = basis.creationRequestId, generation = options.generation();
    const current = taskId ? options.currentTask(taskId) : undefined;
    // Keep the displayed opaque revision. A later read must not silently replace the open form's basis.
    const editor = taskId ? options.planning().beginTaskEdit(current ? { ...structuredClone(current), updatedAt: basis.expectedUpdatedAt } : { id: taskId } as Task) : null;
    const id = `hierarchy:${taskId || creationId}:${++sequence}`;
    let parentId = current?.parentTaskId;
    let parentConfirmed = false;
    let stage: "parent" | "content" | "create" = taskId ? "content" : "create";
    let submitted: Partial<Task> | null = null;
    let closed = false;
    const unavailable = () => !options.active() || generation !== options.generation();
    const map = (draft: Draft) => kind === "epic" ? epicPatch(draft as EpicDraft) : initiativePatch(draft as InitiativeDraft);
    const view = (): HierarchyEditView => {
      const value: ReturnType<HierarchyEditor<Draft>["view"]> = unavailable() ? { phase: "ended" as const, submitted: null, serverTask: null, error: "Die Sitzung wurde beendet.", canResave: false }
        : editor ? editor.view() : (() => { const operation = options.planning().taskLifecycle().find(op => op.id === creationId && op.kind === "create"); return { phase: operation?.phase || "editing", submitted: null, serverTask: null, error: operation?.error || "", canResave: false }; })();
      return { ...value, id, taskId: taskId || "", kind, parentConfirmed, stage,
        submitted: value.phase === "ended" || editor && !value.serverTask ? null : submitted,
        error: parentConfirmed && value.error ? `Die Zuordnung wurde gespeichert. ${value.error}` : value.error };
    };
    async function save(draft: Draft, resave = false): Promise<HierarchySaveResult> {
      if (unavailable() || closed) return { ok: false, error: "Die Sitzung oder der Dialog wurde beendet.", kind: "sessionSuperseded" };
      if (editor && ["saving", "unconfirmed", "blocked", "ended"].includes(editor.view().phase)) return { ok: false, kind: "unconfirmed", error: "Die vorherige Änderung ist noch nicht bestätigt." };
      if (editor?.view().phase === "conflict" && !resave) return { ok: false, kind: "versionConflict", error: editor.view().error };
      const patch = map(draft);
      submitted = { ...structuredClone(patch), ...(kind === "initiative" ? { parentTaskId: (draft as InitiativeDraft).parentTaskId } : {}) };
      retained.set(id, { view, check: () => api.checkOutcome() });
      options.changed();
      if (!editor) {
        const result = await options.planning().createTask({ ...patch, taskType: kind, title: draft.title, description: kind === "epic" ? (draft as EpicDraft).description : (draft as InitiativeDraft).goal, parentTaskId: kind === "initiative" ? (draft as InitiativeDraft).parentTaskId : "", ownerId: kind === "initiative" ? (draft as InitiativeDraft).ownerId : "", creationRequestId: creationId, approveNow: kind === "initiative" && (draft as InitiativeDraft).approveNow });
        if (result.ok) retained.delete(id);
        options.changed(); return result;
      }
      if (resave) parentId = editor.view().serverTask?.parentTaskId;
      const send = resave ? editor.resave : editor.save;
      if (kind === "initiative" && (draft as InitiativeDraft).parentTaskId !== parentId) {
        stage = "parent";
        const parent = await send({ parentTaskId: (draft as InitiativeDraft).parentTaskId });
        if (!parent.ok) return parent;
        parentId = parent.task.parentTaskId;
        parentConfirmed = true;
        // Only this command's actual receipt may advance the editor to its own next CAS stage.
        stage = "content";
        const content = await editor.save(patch);
        if (content.ok) retained.delete(id);
        options.changed(); return content;
      }
      stage = "content";
      const result = await send(patch);
      if (result.ok) retained.delete(id);
      options.changed(); return result;
    }
    const api: HierarchyEditor<Draft> = {
      view, save: draft => save(draft), resave: draft => save(draft, true),
      refreshConflict: () => editor?.refreshConflict() || Promise.resolve(false),
      checkOutcome: () => editor ? editor.checkOutcome() : options.planning().checkTaskLifecycle(creationId),
      close() { closed = true; editor?.close(); if (!submitted || !["unconfirmed", "blocked", "conflict"].includes(view().phase)) retained.delete(id); },
    };
    return api;
  }
  return { clear: () => retained.clear(), views: () => [...retained.values()].map(value => value.view()).filter(view => Boolean(view.taskId)), check: (id: string) => retained.get(id)?.check() || Promise.resolve({ outcome: "not-pending" as const, readStatus: "not-needed" as const }),
    beginEpic: (basis: Pick<EpicDraft, "id" | "expectedUpdatedAt" | "creationRequestId">) => begin<EpicDraft>("epic", basis),
    beginInitiative: (basis: Pick<InitiativeDraft, "id" | "expectedUpdatedAt" | "creationRequestId">) => begin<InitiativeDraft>("initiative", basis) };
}
