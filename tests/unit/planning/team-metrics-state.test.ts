import { expect, test, vi } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { TeamMetricsModel } from "@/features/team/model/team-read-model";
import type { Profile } from "@/lib/types";

const actor = { id: "ceo", name: "Ada", platformRole: "ceo" as const, githubLogin: "ada" };
const member: Profile = { ...actor, id: "founder", name: "Bea", platformRole: "founder", orgRole: "Founder", weeklyCapacity: 20 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(now: number, metrics: () => Promise<{ model: TeamMetricsModel; readAuthority: { userId: string; deadline: number }; currentProfile: typeof actor }>, options?: { deadline?: number; saveTeamProfile?: () => Promise<Partial<Profile> & { id: string }>; source?: () => string }) {
  const deadline = options?.deadline ?? now + 120_000;
  const session = { userId: "user", user: { id: "user" }, revision: "revision", expiresAt: (now + 3_600_000) / 1000 };
  const people = [actor as Profile, member];
  const state = createPlanningState({ userId: session.userId, initialSession: session, initialCurrentProfile: actor, initialWorkspace: "team", initialData: { ...emptyPlanningShellState, profiles: people }, adapter: {
    now: () => Date.now(), saveTask: async task => ({ task }),
    readWorkspace: async () => ({ data: { ...emptyPlanningShellState, profiles: people }, coverage: { profiles: "complete", tasks: "partial" }, scopeRevision: "source-1", currentProfile: actor, readAuthority: { userId: session.userId, deadline } }),
    readTeamMetrics: metrics,
    readPlanningSourceVersion: async () => options?.source?.() || "source-1",
    saveTeamProfile: options?.saveTeamProfile,
  } });
  return { ...state, deadline, session };
}
function validMetrics(now: number, deadline: number) {
  return { model: { revision: "source-1", scopeRevision: "source-1", observedAt: new Date(now).toISOString(), validUntil: null, coverage: "complete" as const, metricsByProfileId: { ceo: { openTasks: 0, highPriorityTasks: 0, loadHours: 0 }, founder: { openTasks: 3, highPriorityTasks: 1, loadHours: 9 } } }, readAuthority: { userId: "user", deadline }, currentProfile: actor };
}

test("Team people stay usable when metrics fail and a later retry succeeds", async () => {
  const now = Date.now(); let attempts = 0;
  const state = fixture(now, async () => { attempts++; if (attempts === 1) throw Object.assign(new Error("unavailable"), { status: 503 }); return validMetrics(now, now + 120_000); });
  try {
    expect(await state.planning.refreshWorkspace("team")).toBe(true);
    expect(state.planning.team().profiles.map(profile => profile.id)).toEqual(["ceo", "founder"]);
    expect(await state.planning.loadTeamMetrics()).toBe(false);
    expect(state.planning.teamMetrics()).toMatchObject({ readStatus: "unavailable", metricsByProfileId: {} });
    expect(state.planning.beginTeamProfileEdit(member).view().current?.id).toBe("founder");
    expect(await state.planning.loadTeamMetrics()).toBe(true);
    expect(state.planning.teamMetrics()).toMatchObject({ readStatus: "current", metricsByProfileId: { founder: { openTasks: 3, highPriorityTasks: 1, loadHours: 9 } } });
  } finally { state.internal.dispose(); }
});

test("an earlier metrics response cannot publish after a confirmed Team profile write", async () => {
  const now = Date.now(), held = deferred<ReturnType<typeof validMetrics>>();
  const state = fixture(now, () => held.promise, { saveTeamProfile: async () => ({ id: "founder", weeklyCapacity: 37 }) });
  try {
    expect(await state.planning.refreshWorkspace("team")).toBe(true);
    const old = state.planning.loadTeamMetrics();
    await Promise.resolve();
    await state.planning.saveTeamProfile("founder", { weeklyCapacity: 37 });
    held.resolve(validMetrics(now, now + 120_000));
    expect(await old).toBe(false);
    expect(state.planning.teamMetrics().metricsByProfileId).toEqual({});
    expect(state.planning.team().profiles.find(profile => profile.id === "founder")?.weeklyCapacity).toBe(37);
  } finally { state.internal.dispose(); }
});

test("a source change invalidates the metric receipt and an expired original deadline notifies subscribers", async () => {
  vi.useFakeTimers();
  const now = Date.now(), deadline = now + 1000; let source = "source-1", notifications = 0;
  const state = fixture(now, async () => validMetrics(now, deadline), { deadline, source: () => source });
  const release = state.planning.activateTeamMetrics(), unsubscribe = state.planning.subscribe(() => { notifications++; });
  try {
    expect(await state.planning.refreshWorkspace("team")).toBe(true);
    expect(await state.planning.loadTeamMetrics()).toBe(true);
    source = "source-2";
    await state.planning.checkTeamMetricsSource();
    expect(state.planning.teamMetrics().metricsByProfileId).toEqual({});
    expect(state.planning.team().readStatus).toBe("stale");
    source = "source-1";
    expect(await state.planning.refreshWorkspace("team")).toBe(true);
    expect(await state.planning.loadTeamMetrics()).toBe(true);
    const before = notifications;
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.planning.teamMetrics().readStatus).toBe("stale");
    expect(notifications).toBeGreaterThan(before);
  } finally { unsubscribe(); release(); state.internal.dispose(); vi.useRealTimers(); }
});

test("a forbidden metrics response immediately hides Team people and metrics", async () => {
  const now = Date.now();
  const state = fixture(now, async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); });
  try {
    expect(await state.planning.refreshWorkspace("team")).toBe(true);
    expect(await state.planning.loadTeamMetrics()).toBe(false);
    expect(state.planning.team()).toMatchObject({ readStatus: "forbidden", profiles: [] });
    expect(state.planning.teamMetrics()).toMatchObject({ readStatus: "forbidden", metricsByProfileId: {} });
  } finally { state.internal.dispose(); }
});
