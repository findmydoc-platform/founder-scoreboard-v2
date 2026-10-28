import type { FounderSprintScore, PlanningShellState, ScoreObjection, ScoreObjectionResolutionInput } from "@/lib/types";
import type { ScoreObjectionConfirmation, ScoreObjectionEditor, ScoreObjectionOperation, ScoreObjectionOutcome, ScoreObjectionCreationEditor } from "@/features/sprint/model/score-objection-state";
import type { PlanningReadCoverage } from "./planning-read-scopes";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "../planning-state";

const pair = (row: { sprintId: string; profileId: string }) => JSON.stringify([row.sprintId, row.profileId]);
const same = (left: unknown, right: unknown): boolean => {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
};
const basisOf = (row: ScoreObjection | FounderSprintScore | null | undefined) => row?.persistenceBasis || row || null;

export function createScoreObjectionState(options: {
  current(): PlanningShellState; update(data: PlanningShellState): void; changed(): void;
  nextSequence(): number; active(): boolean; generation(): number; refresh(): Promise<boolean>; readStatus(): PlanningReadStatus;
  dependencyPending?(sprintId: string): boolean;
  canRead?(): boolean;
  create?: (sprintId: string, comment: string) => Promise<ScoreObjectionConfirmation>;
  process?: (objection: ScoreObjection, score: FounderSprintScore | null, input: ScoreObjectionResolutionInput) => Promise<ScoreObjectionConfirmation>;
}) {
  const operations = new Map<string, { view(): ScoreObjectionOperation; resume(): ScoreObjectionEditor; deny(): void }>();
  const creations = new Map<string, { view(): ScoreObjectionOperation; resume(): ScoreObjectionCreationEditor }>();
  const checks = new Map<string, Promise<PlanningTaskSaveCheck>>();
  const tails = new Map<number, { context: symbol; result: Promise<ScoreObjectionOutcome> }>();
  const stamps = new Map<string, number>(), readStamps = new Map<string, number>(), completeReads = new Map<string, number>();
  const invalidScores = new Set<string>();
  const invalidSprints = new Set<string>();
  let nextId = 0;
  let lockAt = 0;
  const blocks = (sprintId: string, profileId?: string, except?: string) => [...operations.entries(), ...creations.entries()].some(([id, item]) => id !== except
    && item.view().sprintId === sprintId && (!profileId || item.view().profileId === profileId)
    && ["saving", "unconfirmed", "conflict"].includes(item.view().phase));
  const scoreCurrent = (sprintId: string, profileId: string) => !invalidScores.has(pair({sprintId,profileId})) && (!invalidSprints.has(sprintId)||(readStamps.get(`founderSprintScores:${pair({sprintId,profileId})}`)||0)>lockAt) && ![...operations.values()].some(item=>{
    const view = item.view();
    return view.sprintId === sprintId
      && view.profileId === profileId
      && ["saving", "unconfirmed"].includes(view.phase)
      && view.submitted
      && ("action" in view.submitted)
      && view.submitted.action === "resolve"
      && view.submitted.status === "accepted";
  });
  const currentScore = (row: { sprintId: string; profileId: string }) => options.current().founderSprintScores.find(item => pair(item) === pair(row)) || null;
  const returnedScore = (row: { sprintId: string; profileId: string }, started: number) => (readStamps.get(`founderSprintScores:${pair(row)}`) || 0) > started
    || (completeReads.get("founderSprintScores") || 0) > started;
  return {
    blocks,
    deny() { for(const operation of operations.values())operation.deny(); },
    scoreCurrent,
    scoresUnconfirmed:()=>invalidScores.size>0||invalidSprints.size>0||[...operations.values()].some(item=>!scoreCurrent(item.view().sprintId,item.view().profileId)),
    views: (sprintId: string) => options.active() ? [...operations.values(), ...creations.values()].map(item => item.view()).filter(view => view.sprintId === sprintId) : [],
    resume: (id: string) => operations.get(id)?.resume() || null,
    resumeCreation: (id: string) => creations.get(id)?.resume() || null,
    beginCreation(sprintId: string, profileId: string): ScoreObjectionCreationEditor {
      const generation = options.generation();
      const active = () => options.active() && generation === options.generation() && options.canRead?.() !== false;
      const ended = (): ScoreObjectionOutcome => ({ ok: false, kind: "sessionSuperseded", error: "Die Bearbeitung wurde beendet." });
      let closed = false;
      let view: ScoreObjectionOperation = { id: String(++nextId), sprintId, profileId, objectionId: null, originalObjection:null, phase: "editing", submitted: null, error: "", serverObjection: null, serverScore: null, canResave: false, checkStatus: "not-checked" };
      const readView = (): ScoreObjectionOperation => active() ? structuredClone(view) : { ...view, phase: "ended", submitted: null, originalObjection:null, serverObjection: null, serverScore: null };
      const editor: ScoreObjectionCreationEditor = {
        view: readView,
        async submit(comment) {
          if (closed || !active()) return ended();
          if (["saving", "saved", "unconfirmed"].includes(view.phase) || blocks(sprintId, profileId, view.id) || options.dependencyPending?.(sprintId)) return { ok: false, kind: "unconfirmed", error: "Die vorherige Score-Änderung ist noch nicht bestätigt." };
          if (!comment.trim()) return { ok: false, kind: "rejected", error: "Ein Einwand ist erforderlich." };
          view = { ...view, phase: "saving", submitted: { comment }, error: "" }; options.changed();
          const started=options.nextSequence();
          try {
            if (!options.create) throw Object.assign(new Error("Einwand-Erstellung ist nicht verfügbar."), { status: 400 });
            const result = await options.create(sprintId, comment);
            if (!active()) return ended();
            if (!result.objection?.id || result.objection.sprintId !== sprintId || result.objection.profileId !== profileId) throw new Error("Der Einwand ist noch nicht bestätigt.");
            const data=options.current();
            const known=data.scoreObjections.find(row=>row.id===result.objection.id);
            const foreign=(readStamps.get(`scoreObjections:${result.objection.id}`)||0)>started&&known&&!same(basisOf(known),basisOf(result.objection));
            stamps.set(`scoreObjections:${result.objection.id}`, options.nextSequence());
            if(!foreign)options.update({ ...data, scoreObjections: [...data.scoreObjections.filter(row => row.id !== result.objection.id), result.objection] });
            view = { ...view, phase: "saved", error: "" }; options.changed(); return { ok: true, ...result };
          } catch (error) {
            if (!active()) return ended();
            const failure = error as { status?: number; code?: string };
            const unknown = failure.status === undefined || failure.status >= 500 || failure.code === "session_superseded";
            view = { ...view, phase: unknown ? "unconfirmed" : "rejected", error: error instanceof Error ? error.message : "Einwand konnte nicht eingereicht werden." }; options.changed();
            return { ok: false, kind: failure.code === "session_superseded" ? "sessionSuperseded" : unknown ? "unconfirmed" : "rejected", error: view.error };
          }
        },
        checkOutcome() {
          if (!active()) return Promise.resolve({ outcome: "session-ended", readStatus: "not-needed" });
          if (view.phase !== "unconfirmed") return Promise.resolve({ outcome: "not-pending", readStatus: "not-needed" });
          const prior = checks.get(view.id); if (prior) return prior;
          view = { ...view, checkStatus: "checking" }; options.changed();
          const check = (async (): Promise<PlanningTaskSaveCheck> => {
            await options.refresh(); if (!active()) return { outcome: "session-ended", readStatus: "not-needed" };
            view = { ...view, checkStatus: options.readStatus() }; options.changed();
            return { outcome: "unconfirmed", readStatus: options.readStatus() };
          })();
          checks.set(view.id, check); void check.then(() => { if (checks.get(view.id) === check) checks.delete(view.id); }); return check;
        },
        close() { closed = true; if (!view.submitted) creations.delete(view.id); },
      };
      creations.set(view.id, { view: readView, resume: () => { closed = false; return editor; } }); return editor;
    },
    acceptLock(sprintId: string) { lockAt = options.nextSequence();invalidSprints.add(sprintId); },
    acceptRead(data: PlanningShellState, coverage: PlanningReadCoverage, started: number, returned = data) {
      let stale = false;
      const next = { ...data };
      for (const key of ["scoreObjections", "founderSprintScores"] as const) {
        const current = options.current()[key];
        if (!coverage[key]) { Object.assign(next, { [key]: current }); continue; }
        if ((completeReads.get(key) || 0) > started || key === "founderSprintScores" && lockAt > started) {
          Object.assign(next, { [key]: current }); stale = true; continue;
        }
        const identity = (row: ScoreObjection | FounderSprintScore) => key === "founderSprintScores" ? pair(row) : row.id;
        const merged = new Map((coverage[key] === "partial" ? current : []).map(row => [identity(row), row]));
        for (const row of returned[key]) {
          const stampKey = `${key}:${identity(row)}`;
          if (Math.max(stamps.get(stampKey) || 0, readStamps.get(stampKey) || 0) <= started) {
            merged.set(identity(row), row); readStamps.set(stampKey, started);
            if (key === "founderSprintScores") invalidScores.delete(pair(row));
          }
        }
        for (const row of current) if (Math.max(stamps.get(`${key}:${identity(row)}`) || 0, readStamps.get(`${key}:${identity(row)}`) || 0) > started) {
          merged.set(identity(row), row); stale = true;
        }
        if (coverage[key] === "complete") { completeReads.set(key, started);if(key==="founderSprintScores"&&started>lockAt)invalidSprints.clear(); if (key === "founderSprintScores") for(const key of invalidScores) if((stamps.get(`founderSprintScores:${key}`)||0)<=started)invalidScores.delete(key); }
        Object.assign(next, { [key]: [...merged.values()] });
      }
      return { data: next, stale };
    },
    begin(shown: ScoreObjection, score: FounderSprintScore | null): ScoreObjectionEditor {
      const generation = options.generation(), context = Symbol();
      let closed = false;
      const active = () => options.active() && generation === options.generation() && options.canRead?.() !== false;
      const ended = (): ScoreObjectionOutcome => ({ ok: false, kind: "sessionSuperseded", error: "Die Bearbeitung wurde beendet." });
      let basis = structuredClone(shown), basisScore = structuredClone(score);
      let view: ScoreObjectionOperation = { id: String(++nextId), sprintId: shown.sprintId, profileId: shown.profileId, objectionId: shown.id, originalObjection:structuredClone(shown), phase: "editing", submitted: null, error: "", serverObjection: null, serverScore: null, canResave: false, checkStatus: "not-checked" };
      const readView = (): ScoreObjectionOperation => !active() ? { ...view, phase: "ended", submitted: null, originalObjection:null, serverObjection: null, serverScore: null, canResave: false } : structuredClone(view);
      const editor: ScoreObjectionEditor = {
        view: readView,
        submit(supplied) {
          if (closed || !active()) return Promise.resolve(ended());
          const input = structuredClone(supplied);
          if (["unconfirmed", "conflict"].includes(view.phase)) return Promise.resolve({ ok: false, kind: view.phase === "conflict" ? "versionConflict" : "unconfirmed", error: view.error });
          if (blocks(basis.sprintId, basis.profileId, view.id) || options.dependencyPending?.(basis.sprintId)) {
            view = { ...view, phase: "blocked", submitted: input, error: "Eine vorherige Score-Änderung ist noch nicht bestätigt. Diese Eingabe wurde noch nicht gesendet." };
            options.changed(); return Promise.resolve({ ok: false, kind: "unconfirmed", error: view.error });
          }
          const previous = tails.get(basis.id);
          let original = structuredClone(basis), originalScore = structuredClone(basisScore);
          view = { ...view, phase: "saving", submitted: input, error: "" }; options.changed();
          const saving = (async (): Promise<ScoreObjectionOutcome> => {
            if (previous) {
              const predecessor = await previous.result;
              if (!predecessor.ok) { view = { ...view, phase: "blocked", error: predecessor.error }; options.changed(); return predecessor; }
              if (previous.context === context) { original = structuredClone(predecessor.objection); if (predecessor.score) originalScore = structuredClone(predecessor.score); }
            }
            if (!active()) return ended();
            const started = options.nextSequence();
            try {
              const current = options.current().scoreObjections.find(row => row.id === original.id);
              const accepted = input.action === "resolve" && input.status === "accepted";
              if (!same(basisOf(current), basisOf(original)) || accepted && (!same(basisOf(currentScore(original)), basisOf(originalScore)) || invalidScores.has(pair(original)))) {
                throw Object.assign(new Error("Einwand oder Score inzwischen geändert. Deine Eingaben bleiben erhalten."), { status: 409, code: "score_objection_basis_conflict" });
              }
              if (!options.process) throw Object.assign(new Error("Die Einwand-Aktion ist nicht verfügbar."), { status: 400 });
              const result = await options.process(original, originalScore, input);
              if (!active()) return ended();
              if (!result.objection || result.objection.id !== original.id || pair(result.objection) !== pair(original)) throw new Error("Die Entscheidung ist noch nicht bestätigt.");
              const data = options.current();
              const known = data.scoreObjections.find(row => row.id === original.id);
              const foreign = (readStamps.get(`scoreObjections:${original.id}`) || 0) > started && !same(basisOf(known), basisOf(original)) && !same(basisOf(known), basisOf(result.objection));
              const next = { ...data, scoreObjections: foreign ? data.scoreObjections : [...data.scoreObjections.filter(row => row.id !== original.id), result.objection] };
              stamps.set(`scoreObjections:${original.id}`, options.nextSequence());
              if (result.score && pair(result.score) === pair(original)) {
                const scoreKey = `founderSprintScores:${pair(original)}`;
                const newer = (readStamps.get(scoreKey) || 0) > started && !same(basisOf(currentScore(original)), basisOf(originalScore)) && !same(basisOf(currentScore(original)), basisOf(result.score));
                if (!newer) next.founderSprintScores = [...data.founderSprintScores.filter(row => pair(row) !== pair(original)), result.score];
                stamps.set(scoreKey, options.nextSequence()); invalidScores.delete(pair(original));
              } else if (accepted) {invalidScores.add(pair(original));stamps.set(`founderSprintScores:${pair(original)}`,options.nextSequence());}
              options.update(next); basis = structuredClone(result.objection); if (result.score) basisScore = structuredClone(result.score);
              view = { ...view, phase: "saved", error: accepted && !result.score ? "Entscheidung bestätigt. Der aktuelle Score muss noch geladen werden." : "" }; options.changed();
              return { ok: true, ...result };
            } catch (error) {
              if (!active()) return ended();
              const failure = error as { status?: number; code?: string };
              const conflict = failure.code === "score_objection_basis_conflict";
              const unknown = !conflict && (failure.status === undefined || failure.status >= 500 || failure.code === "session_superseded");
              view = { ...view, phase: conflict ? "conflict" : unknown ? "unconfirmed" : "rejected", error: error instanceof Error ? error.message : "Einwand konnte nicht gespeichert werden." }; options.changed();
              return { ok: false, kind: conflict ? "versionConflict" : failure.code === "session_superseded" ? "sessionSuperseded" : unknown ? "unconfirmed" : "rejected", error: view.error };
            }
          })();
          tails.set(original.id, { context, result: saving });
          void saving.then(() => { if (tails.get(original.id)?.result === saving) tails.delete(original.id); });
          return saving;
        },
        async refreshConflict() {
          if (view.phase !== "conflict" || !active()) return false;
          const started = options.nextSequence(), loaded = await options.refresh();
          if (!active()) return false;
          const current = options.current().scoreObjections.find(row => row.id === basis.id);
          const objectionReturned = (readStamps.get(`scoreObjections:${basis.id}`) || 0) > started;
          const scoreReturned = returnedScore(basis, started);
          const accepted = view.submitted && "action" in view.submitted && view.submitted.action === "resolve" && view.submitted.status === "accepted";
          view = { ...view, serverObjection: loaded && objectionReturned ? current || null : null, serverScore: loaded && scoreReturned ? currentScore(basis) : null, canResave: Boolean(loaded && current && objectionReturned && (!accepted || scoreReturned)) }; options.changed();
          return view.canResave;
        },
        resubmit(input) {
          if (!active()) return Promise.resolve(ended());
          if (!view.canResave || !view.serverObjection) return Promise.resolve({ ok: false, kind: "rejected", error: "Vergleiche zuerst den aktuellen Einwand und Score." });
          basis = structuredClone(view.serverObjection); basisScore = structuredClone(view.serverScore); view = { ...view, phase: "editing", canResave: false };
          return editor.submit(input);
        },
        checkOutcome() {
          if (!active()) return Promise.resolve({ outcome: "session-ended", readStatus: "not-needed" });
          if (view.phase !== "unconfirmed") return Promise.resolve({ outcome: "not-pending", readStatus: "not-needed" });
          const prior = checks.get(view.id); if (prior) return prior;
          const started = options.nextSequence(); view = { ...view, checkStatus: "checking" }; options.changed();
          const check = (async (): Promise<PlanningTaskSaveCheck> => {
            await options.refresh(); if (!active()) return { outcome: "session-ended", readStatus: "not-needed" };
            const status = options.readStatus();
            view = { ...view, checkStatus: status, serverObjection: (readStamps.get(`scoreObjections:${basis.id}`) || 0) > started ? options.current().scoreObjections.find(row => row.id === basis.id) || null : null, serverScore: returnedScore(basis, started) ? currentScore(basis) : null }; options.changed();
            return { outcome: "unconfirmed", readStatus: status };
          })();
          checks.set(view.id, check); void check.then(() => { if (checks.get(view.id) === check) checks.delete(view.id); }); return check;
        },
        close() { closed = true; if (!view.submitted) operations.delete(view.id); },
      };
      operations.set(view.id, { view: readView, resume: () => { closed = false; return editor; }, deny(){view={...view,serverObjection:null,serverScore:null,canResave:false};} });
      return editor;
    },
    clear() { stamps.clear(); readStamps.clear(); completeReads.clear(); checks.clear(); tails.clear(); invalidScores.clear(); invalidSprints.clear(); operations.clear(); creations.clear(); lockAt = 0; },
  };
}
