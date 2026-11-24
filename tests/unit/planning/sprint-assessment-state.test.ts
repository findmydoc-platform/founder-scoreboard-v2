import { expect, test } from "vitest";
import { createPlanningState, type PlanningStateAdapter } from "@/features/planning/model/internal/planning-state-owner";
import { buildSprintScoreViewModel } from "@/features/sprint/model/sprint-score-view-model";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";

const now = Date.parse("2026-11-21T12:00:00Z");
const sprint = { id: "selected", name: "Selected Sprint", startDate: "2026-11-20", endDate: "2026-12-01", status: "active" as const, reviewDueAt: "", scoreLocked: false };
const actor = { id: "assessor", name: "Assessor", platformRole: "ceo" as const, githubLogin: "" };

function receipt(id = sprint.id): import("@/features/sprint/model/sprint-assessment-read").SprintAssessmentReceipt {
  return {
    sprintId: id, sourceRevision: "selected-source", evaluatedAt: new Date(now).toISOString(), validUntil: new Date(now + 60_000).toISOString(),
    readAuthority: { userId: "user", deadline: now + 60_000 }, readActor: { profileId: actor.id, platformRole: actor.platformRole },
    scoreLocked: false, scoreRows: [], inputCounts: { people: 0, items: 0, commitments: 0, scores: 0, strikeStates: 0, objections: 0, meetings: 0, attendance: 0 },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function owner(adapter: Partial<PlanningStateAdapter>) {
  return createPlanningState({
    userId: "user", initialWorkspace: "sprint", initialCurrentProfile: actor,
    initialSession: { userId: "user", user: { id: "user" }, revision: "session", expiresAt: (now + 120_000) / 1000 },
    initialData: { ...emptyPlanningShellState, sprints: [sprint] },
    adapter: { now: () => now, saveTask: async () => ({ task: {} }), readWorkspace: async () => null, ...adapter },
  });
}

test("Assessment distinguishes unverified inputs from proven empty results without removing Sprint controls", async () => {
  const attempts: string[] = [];
  const state = owner({
    readSprintAssessment: async id => {
      attempts.push(id);
      if (attempts.length === 1) throw Object.assign(new Error("Supporting inputs unavailable"), { status: 503 });
      return receipt(id);
    },
  });
  try {
    expect(state.planning.sprintAssessment(sprint.id)).toEqual({ readStatus: "not-loaded", scoreRows: null });
    expect(attempts).toEqual([]);
    await expect(state.planning.loadSprintAssessment(sprint.id)).resolves.toBe(false);
    expect(state.planning.sprintAssessment(sprint.id)).toEqual({ readStatus: "unavailable", scoreRows: null });
    expect(state.planning.sprintWorkspace().model.sprints).toEqual([sprint]);
    await expect(state.planning.loadSprintAssessment(sprint.id, { refresh: true })).resolves.toBe(true);
    expect(state.planning.sprintAssessment(sprint.id)).toEqual({ readStatus: "current", scoreRows: [], scoreLocked: false });
    expect(attempts).toEqual([sprint.id, sprint.id]);
  } finally { state.internal.dispose(); }
});

test("an unchanged observation preserves the original assessment deadline", async () => {
  let clock = now;
  const state = owner({
    now: () => clock,
    readSprintAssessment: async () => ({ ...receipt(), validUntil: new Date(now + 1_000).toISOString() }),
    observeSprintAssessment: async () => ({ ...receipt(), readAuthority: { userId: "user", deadline: now + 100_000 } }),
  });
  try {
    await expect(state.planning.loadSprintAssessment(sprint.id)).resolves.toBe(true);
    clock += 500;
    await expect(state.planning.checkSprintAssessment(sprint.id)).resolves.toBe(true);
    clock += 500;
    expect(state.planning.sprintAssessment(sprint.id)).toEqual({ readStatus: "stale", scoreRows: null });
  } finally { state.internal.dispose(); }
});

test("a changed supporting-data revision invalidates only the score view without repeating the full read", async () => {
  let reads = 0;
  const state = owner({
    readSprintAssessment: async () => { reads++; return receipt(); },
    observeSprintAssessment: async () => ({ ...receipt(), sourceRevision: "related-input-changed" }),
  });
  try {
    await expect(state.planning.loadSprintAssessment(sprint.id)).resolves.toBe(true);
    await expect(state.planning.checkSprintAssessment(sprint.id)).resolves.toBe(false);
    expect(state.planning.sprintAssessment(sprint.id)).toEqual({ readStatus: "stale", scoreRows: null });
    expect(state.planning.sprintWorkspace().model.sprints).toEqual([sprint]);
    expect(reads).toBe(1);
  } finally { state.internal.dispose(); }
});

test("a late Assessment response after session replacement cannot publish totals", async () => {
  const read = deferred<ReturnType<typeof receipt>>();
  const started = deferred<void>();
  const state = owner({ readSprintAssessment: () => { started.resolve(); return read.promise; } });
  try {
    const running = state.planning.loadSprintAssessment(sprint.id);
    await started.promise;
    state.internal.bindSession({ userId: "user", user: { id: "user" }, revision: "replacement", expiresAt: (now + 120_000) / 1000 });
    read.resolve(receipt());
    await expect(running).resolves.toBe(false);
    expect(state.planning.sprintAssessment(sprint.id)).toEqual({ readStatus: "not-loaded", scoreRows: null });
  } finally { state.internal.dispose(); }
});

test("an Assessment denial removes only that authorized scope", async () => {
  const state = owner({
    readSprintAssessment: async () => receipt(),
    observeSprintAssessment: async () => { throw Object.assign(new Error("No longer permitted"), { status: 403 }); },
  });
  try {
    await expect(state.planning.loadSprintAssessment(sprint.id)).resolves.toBe(true);
    await expect(state.planning.checkSprintAssessment(sprint.id)).resolves.toBe(false);
    expect(state.planning.sprintAssessment(sprint.id)).toEqual({ readStatus: "forbidden", scoreRows: null });
    expect(state.planning.sprintWorkspace().model.sprints).toEqual([sprint]);
  } finally { state.internal.dispose(); }
});

test("a confirmed Assessment permits editing its independently current commitment", async () => {
  const profile = { ...actor, orgRole: "CEO", weeklyCapacity: 40 };
  const commitment = { id: 7, sprintId: sprint.id, profileId: profile.id, commitmentLevel: "Lite" as const, weeklyHours: 22, note: "", updatedAt: "2026-11-21T11:00:00Z" };
  const writes: number[] = [];
  const state = owner({
    readSprintAssessment: async () => ({
      ...receipt(),
      inputCounts: { ...receipt().inputCounts, people: 1, commitments: 1 },
      scoreRows: buildSprintScoreViewModel({
        data: { ...emptyPlanningShellState, sprints: [sprint], profiles: [profile], sprintCommitments: [commitment] },
        selectedSprintId: sprint.id,
      }).scoreRows,
    }),
    saveSprintCommitment: async (basis, patch) => {
      writes.push(basis.id);
      return { commitment: { ...basis, ...patch, updatedAt: "2026-11-21T12:01:00Z" } };
    },
  });
  try {
    await expect(state.planning.loadSprintAssessment(sprint.id)).resolves.toBe(true);
    const displayed = state.planning.sprintAssessment(sprint.id).scoreRows![0].commitment;
    await expect(state.planning.beginSprintCommitmentEdit(displayed).save({ weeklyHours: 24 })).resolves.toMatchObject({ ok: true });
    expect(writes).toEqual([commitment.id]);
    expect(state.planning.sprintAssessment(sprint.id)).toEqual({ readStatus: "stale", scoreRows: null });
  } finally { state.internal.dispose(); }
});

test("an open commitment draft survives unavailable Assessment without sending from an expired basis", async () => {
  const profile = { ...actor, orgRole: "CEO", weeklyCapacity: 40 };
  const rows = buildSprintScoreViewModel({ data: { ...emptyPlanningShellState, sprints: [sprint], profiles: [profile] }, selectedSprintId: sprint.id }).scoreRows;
  let writes = 0;
  const state = owner({
    readSprintAssessment: async () => ({ ...receipt(), inputCounts: { ...receipt().inputCounts, people: 1 }, scoreRows: rows }),
    observeSprintAssessment: async () => ({ ...receipt(), sourceRevision: "support-changed" }),
    saveSprintCommitment: async (basis, patch) => {
      writes++;
      return { commitment: { ...basis, ...patch, id: 12, updatedAt: "2026-11-21T12:01:00Z" } };
    },
  });
  try {
    await state.planning.loadSprintAssessment(sprint.id);
    const editor = state.planning.beginSprintCommitmentEdit(rows[0].commitment);
    editor.setHoursDraft("26");
    await state.planning.checkSprintAssessment(sprint.id);
    await expect(editor.save({ weeklyHours: 26 })).resolves.toMatchObject({ ok: false });
    expect(writes).toBe(0);
    editor.close();
    await state.planning.loadSprintAssessment(sprint.id, { refresh: true });
    const resumed = state.planning.resumeSprintCommitmentEdit(sprint.id, profile.id, true);
    expect(resumed?.view().hoursDraft).toBe("26");
    state.internal.bindSession({ userId: "user", user: { id: "user" }, revision: "replacement", expiresAt: (now + 120_000) / 1000 });
    expect(state.planning.resumeSprintCommitmentEdit(sprint.id, profile.id, true)).toBeNull();
    expect(resumed?.view().hoursDraft).toBeUndefined();
  } finally { state.internal.dispose(); }
});
