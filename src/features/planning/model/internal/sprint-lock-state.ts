import type { BrowserSessionSnapshot } from "@/lib/credentials/browser";
import type { PlanningShellState, Sprint, Task } from "@/lib/types";
import type { createSprintCompletionState } from "./sprint-completion-state";
import type { PlanningReadStatus } from "../planning-state";
import type { SprintPlanningOptions } from "@/features/sprint/model/sprint-planning-options";
import type { SprintLockBasis, SprintLockEditor, SprintLockObservation, SprintLockReceipt, SprintLockResult, SprintLockView } from "@/features/sprint/model/sprint-lock";
export function createSprintLockState(options: {
    dependenciesPending(basis: SprintLockBasis): boolean;
    active(): boolean;
    generation(): number;
    actorBinding(): string;
    current(): PlanningShellState;
    changed(): void;
    denied(): boolean;
    nextSequence(): number;
    refresh(): Promise<boolean>;
    readStatus(): PlanningReadStatus;
    lock?: (basis: SprintLockBasis, completionBasis?: string, expectedSession?: Pick<BrowserSessionSnapshot, "userId" | "revision">) => Promise<SprintLockReceipt>;
    completion?: Pick<ReturnType<typeof createSprintCompletionState>, "current" | "load" | "invalidate">;
    observe?: (sprintId: string) => Promise<SprintLockObservation>;
    accept(receipt: SprintLockReceipt, basis: SprintLockBasis, started: number): void;
    plan(input: SprintPlanningOptions): Promise<import("@/features/sprint/model/sprint-plan").SprintPlanResult>;
}) {
    const entries = new Map<symbol, {
        id: string;
        editor: SprintLockEditor;
        basis(): SprintLockBasis;
    }>();
    const unresolved = () => [...entries.values()].filter(entry => ["saving", "unconfirmed"].includes(entry.editor.view().phase));
    return {
        pending: () => unresolved().length > 0,
        blocksSprint: (id: string) => unresolved().some(entry => entry.id === id),
        blocksTask: (task: Task, targetSprint?: string) => [...entries.values()].some(entry => { const view = entry.editor.view(), basis = entry.basis(); if (["saving", "unconfirmed"].includes(view.phase))
            return entry.id === task.sprintId || entry.id === targetSprint || basis.tasks.some(row => row.id === task.id); if (view.phase !== "locked")
            return false; const original = basis.tasks.find(row => row.id === task.id); const current = options.current().tasks.find(row => row.id === task.id); return Boolean(original && current && !current.scoreFinal && original.updatedAt === current.updatedAt); }),
        async check(id?: string) { const entry = [...entries.values()].findLast(entry => (!id || entry.id === id) && ["saving", "unconfirmed", "locked"].includes(entry.editor.view().phase)); if (!entry)
            return { outcome: "not-pending" as const, readStatus: "not-needed" as const }; const result = await entry.editor.checkOutcome(); return { ...result, outcome: result.outcome === "confirmed" ? "not-pending" as const : result.outcome }; },
        views: (id: string) => options.active() ? [...entries.values()].filter(entry => entry.id === id).map(entry => entry.editor.view()) : [],
        resume: (id: string) => [...entries.values()].findLast(entry => entry.id === id && entry.editor.view().submitted)?.editor || null,
        project(data: PlanningShellState) { const saving = new Set([...entries.values()].filter(entry => ["saving", "unconfirmed"].includes(entry.editor.view().phase)).map(entry => entry.id)); return { ...data, sprints: data.sprints.map(sprint => saving.has(sprint.id) ? { ...sprint, status: "closed" as const, scoreLocked: true } : sprint) }; },
        begin(shown: Sprint, tasks: readonly Task[], completionRevision?: number): SprintLockEditor {
            let basis: SprintLockBasis = { sprint: structuredClone(shown), tasks: tasks.map(task => ({ id: task.id, title: task.title, updatedAt: task.updatedAt })) };
            let view: SprintLockView = { sprintId: shown.id, phase: "ready", submitted: null, receipt: null, error: "", projectionRead: "not-loaded", followUp: { phase: "not-started", error: "" }, serverBasis: null, canRelock: false };
            const generation = options.generation(), key = Symbol(shown.id), actorBinding = options.actorBinding();
            let closed = false;
            let accessDenied = false;
            let checking: Promise<import("@/features/sprint/model/sprint-lock").SprintLockCheck> | undefined;
            const active = () => options.active() && generation === options.generation() && actorBinding === options.actorBinding();
            async function prepareFollowingPlan(): Promise<boolean> {
                if (!active() || !view.receipt || !view.submitted)
                    return false;
                if (["creating", "unconfirmed"].includes(view.followUp.phase))
                    return false;
                const input = structuredClone(view.submitted);
                view = { ...view, followUp: { phase: "creating", error: "" } };
                options.changed();
                const result = await options.plan(input);
                if (!active())
                    return false;
                view = { ...view, followUp: { phase: result.ok ? "confirmed" : result.kind === "unconfirmed" || result.kind === "sessionSuperseded" ? "unconfirmed" : "failed", error: result.ok ? "" : result.error } };
                options.changed();
                return result.ok;
            }
            async function lock(input: SprintPlanningOptions): Promise<SprintLockResult> {
                if (closed || !active())
                    return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
                if (view.phase === "locked" && view.receipt)
                    return { ok: true };
                if (view.phase === "conflict")
                    return { ok: false, kind: "versionConflict", error: "Bitte zuerst den aktuellen Abschlussstand vergleichen." };
                if (["saving", "unconfirmed"].includes(view.phase))
                    return { ok: false, kind: "unconfirmed", error: "Der bereits gesendete Sprint-Abschluss wird weiterverfolgt." };
                if (options.denied() || accessDenied)
                    return { ok: false, kind: "rejected", error: "Kein Zugriff auf den Sprint-Abschluss." };
                const completion = options.completion?.current(shown.id);
                if (options.completion && (!completion || completion.revision !== completionRevision || completion.read.decision.status !== "ready")) {
                    return { ok: false, kind: "rejected", code: "sprint_lock_basis_missing", error: "Prüfe zuerst die aktuelle Grundlage für den Sprint-Abschluss." };
                }
                const token = completion?.read.decision.status === "ready" ? completion.read.decision.token : undefined;
                if (completion) basis = structuredClone(completion.read.basis);
                if (options.dependenciesPending(basis)) {
                    view = { ...view, phase: "blocked", submitted: structuredClone(input), error: "Eine abhängige Änderung ist noch nicht bestätigt. Der Abschluss wurde nicht gesendet." };
                    options.changed();
                    return { ok: false, kind: "unconfirmed", error: view.error };
                }
                const started = options.nextSequence();
                view = { ...view, phase: "saving", submitted: structuredClone(input), error: "" };
                options.changed();
                try {
                    if (basis.sprint.scoreLocked || options.current().sprints.find(sprint => sprint.id === basis.sprint.id)?.scoreLocked)
                        throw Object.assign(new Error("Dieser Sprint ist bereits abgeschlossen."), { status: 409, code: "sprint_already_locked" });
                    if (!basis.sprint.updatedAt || basis.tasks.some(task => !task.updatedAt))
                        throw Object.assign(new Error("Lade den Sprint und seine Aufgaben neu, bevor du ihn abschließt."), { status: 400, code: "sprint_lock_basis_missing" });
                    if (!options.lock)
                        throw Object.assign(new Error("Sprint-Abschluss ist nicht verfügbar."), { status: 400 });
                    if (completion && options.completion?.current(shown.id) !== completion) {
                        throw Object.assign(new Error("Die Abschlussgrundlage hat sich geändert. Prüfe den aktuellen Stand."), { status: 409, code: "sprint_lock_basis_stale" });
                    }
                    const expectedSession = completion?.binding.sessionRevision
                        ? { userId: completion.binding.userId, revision: completion.binding.sessionRevision }
                        : undefined;
                    const receipt = await options.lock(basis, token, expectedSession);
                    if (!active())
                        return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
                    if (receipt.sprint.id !== shown.id || !receipt.sprint.scoreLocked || receipt.sprint.status !== "closed")
                        throw new Error("Sprint-Abschluss unklar.");
                    options.accept(receipt, basis, started);
                    view = { ...view, phase: "locked", receipt, error: "" };
                    options.changed();
                    const loaded = await options.refresh();
                    if (!active())
                        return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
                    view = { ...view, projectionRead: options.readStatus() };
                    options.changed();
                    if (loaded)
                        await prepareFollowingPlan();
                    return { ok: true };
                }
                catch (error) {
                    if (!active())
                        return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
                    const failure = error as {
                        status?: number;
                        code?: string;
                    };
                    const conflict = failure.code === "sprint_lock_conflict" || failure.code === "sprint_lock_tasks_conflict" || failure.code === "sprint_lock_basis_stale";
                    if (conflict || failure.status === 401 || failure.status === 403 || !failure.status || failure.status >= 500) options.completion?.invalidate(shown.id);
                    const unknown = !conflict && (failure.status === undefined || failure.status >= 500 || failure.code === "session_superseded");
                    view = { ...view, phase: conflict ? "conflict" : unknown ? "unconfirmed" : "rejected", error: error instanceof Error ? error.message : "Sprint-Abschluss fehlgeschlagen." };
                    options.changed();
                    return { ok: false, kind: conflict ? "versionConflict" : failure.code === "session_superseded" ? "sessionSuperseded" : unknown ? "unconfirmed" : "rejected", error: view.error, code: failure.code };
                }
            }
            const editor: SprintLockEditor = { view: () => !active() ? { ...view, phase: "ended", submitted: null, receipt: null, serverBasis: null, canRelock: false, error: "", followUp: { phase: "not-started", error: "" } } : options.denied() || accessDenied ? { ...view, submitted: null, receipt: null, serverBasis: null, canRelock: false } : options.completion && view.serverBasis && options.completion.current(shown.id)?.revision !== completionRevision
                ? { ...view, serverBasis: null, canRelock: false } : structuredClone(view), lock, prepareFollowingPlan, checkOutcome() {
                    if (!active())
                        return Promise.resolve({ outcome: "session-ended", readStatus: "not-needed" });
                    if (view.phase === "blocked") {
                        if (options.dependenciesPending(basis))
                            return Promise.resolve({ outcome: "unconfirmed", readStatus: "not-needed" });
                        view = { ...view, phase: "ready", error: "" };
                        options.changed();
                    }
                    if (view.phase !== "unconfirmed")
                        return Promise.resolve({ outcome: "not-pending", readStatus: "not-needed" });
                    if (checking)
                        return checking;
                    const checked = (async (): Promise<import("@/features/sprint/model/sprint-lock").SprintLockCheck> => {
                        try {
                            if (!options.observe)
                                return { outcome: "unconfirmed", readStatus: "unavailable" };
                            const observed = await options.observe(shown.id);
                            if (!active())
                                return { outcome: "session-ended", readStatus: "not-needed" };
                            accessDenied = false;
                            if (observed.receipt?.sprint.id === shown.id && observed.receipt.sprint.scoreLocked && observed.receipt.sprint.status === "closed" && observed.basis.sprint.scoreLocked) {
                                options.accept(observed.receipt, basis, options.nextSequence());
                                view = { ...view, phase: "locked", receipt: observed.receipt, error: "" };
                                options.changed();
                                await options.refresh();
                                if (!active())
                                    return { outcome: "session-ended", readStatus: "not-needed" };
                                view = { ...view, projectionRead: options.readStatus() };
                                options.changed();
                                return { outcome: "confirmed", readStatus: options.readStatus() };
                            }
                            options.changed();
                            return { outcome: "unconfirmed", readStatus: "current" };
                        }
                        catch (error) {
                            if (!active())
                                return { outcome: "session-ended", readStatus: "not-needed" };
                            const status = (error as {
                                status?: number;
                            }).status;
                            accessDenied = status === 401 || status === 403;
                            view = { ...view, error: error instanceof Error ? error.message : "Bestätigung nicht verfügbar." };
                            options.changed();
                            return { outcome: "unconfirmed", readStatus: accessDenied ? "forbidden" : "unavailable" };
                        }
                    })();
                    checking = checked;
                    void checked.finally(() => { if (checking === checked)
                        checking = undefined; });
                    return checked;
                }, async refreshConflict() {
                    if (view.phase !== "conflict" || !active() || (!options.completion && !options.observe))
                        return false;
                    try {
                        if (options.completion) await options.completion.load(shown.id, { refresh: true });
                        if (!active()) return false;
                        const completion = options.completion?.current(shown.id);
                        const observed = options.completion ? completion?.read : await options.observe!(shown.id);
                        if (!active() || !observed) {
                            view = { ...view, canRelock: false, serverBasis: null };
                            options.changed();
                            return false;
                        }
                        accessDenied = false;
                        if (observed.receipt?.sprint.id === shown.id && observed.receipt.sprint.scoreLocked && observed.receipt.sprint.status === "closed" && observed.basis.sprint.scoreLocked) {
                            options.accept(observed.receipt, basis, options.nextSequence());
                            view = { ...view, phase: "locked", receipt: observed.receipt, canRelock: false, serverBasis: null, error: "" };
                            options.changed();
                            await options.refresh();
                            if (!active())
                                return false;
                            view = { ...view, projectionRead: options.readStatus() };
                            options.changed();
                            return false;
                        }
                        const accepted = (!options.completion || completion?.read.decision.status === "ready") && observed.tasksComplete && !observed.basis.sprint.scoreLocked && Boolean(observed.basis.sprint.updatedAt) && observed.basis.tasks.every(task => task.updatedAt);
                        completionRevision = accepted ? completion?.revision : undefined;
                        view = { ...view, serverBasis: accepted ? structuredClone(observed.basis) : null, canRelock: accepted };
                        options.changed();
                        return accepted;
                    }
                    catch {
                        view = { ...view, canRelock: false, serverBasis: null };
                        options.changed();
                        return false;
                    }
                }, relock(input) { if (!view.canRelock || !view.serverBasis || !active())
                    return Promise.resolve({ ok: false, kind: "rejected", error: "Vergleiche zuerst die Änderungen." }); basis = structuredClone(view.serverBasis); view = { ...view, phase: "ready", canRelock: false, serverBasis: null }; return lock(input); }, close() { if (!view.submitted) {
                    closed = true;
                    entries.delete(key);
                } } };
            entries.set(key, { id: shown.id, editor, basis: () => basis });
            return editor;
        },
        clear() { entries.clear(); },
    };
}
