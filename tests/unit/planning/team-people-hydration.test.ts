import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { teamWorkspaceHydration } from "@/features/planning/model/planning-workspace-hydration";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { Profile } from "@/lib/types";

const actor: Profile = { id: "ceo", name: "Ada", platformRole: "ceo", githubLogin: "ada", orgRole: "CEO", weeklyCapacity: 40 };
const member: Profile = { ...actor, id: "founder", name: "Bea", platformRole: "founder", weeklyCapacity: 20 };

function fixture() {
  const now = Date.now();
  const session = { userId: "user", user: { id: "user" }, revision: "session-1", expiresAt: (now + 3_600_000) / 1000 };
  const readAuthority = { userId: "user", deadline: now + 60_000 };
  const model = { revision: "source-1", scopeRevision: "source-1", observedAt: new Date(now).toISOString(), people: [actor, member], items: [], readCoverage: { people: "complete" as const, items: "partial" as const } };
  const read = teamWorkspaceHydration(model, session, readAuthority);
  if (!read) throw new Error("Expected a valid Team hydration receipt");
  return { session, readAuthority, read, data: { ...emptyPlanningShellState, profiles: [actor, member] } };
}

test("a delayed Team page cannot overwrite a confirmed profile write", async () => {
  const { session, readAuthority, read, data } = fixture();
  let profiles = data.profiles;
  const state = createPlanningState({ userId: session.userId, initialSession: session, initialCurrentProfile: actor, initialWorkspace: "team", initialData: data, initialWorkspaceRead: read, adapter: {
    saveTask: async task => ({ task }),
    saveTeamProfile: async () => { profiles = [actor, { ...member, weeklyCapacity: 37 }]; return profiles[1]; },
    readWorkspace: async () => ({ data: { ...emptyPlanningShellState, profiles }, coverage: { profiles: "complete", tasks: "partial" }, scopeRevision: "source-1", currentProfile: actor, readAuthority }),
  } });
  try {
    expect(state.planning.team()).toMatchObject({ completeness: "complete", profiles: [{ id: "ceo" }, { id: "founder", weeklyCapacity: 20 }] });
    await state.planning.saveTeamProfile("founder", { weeklyCapacity: 37 });
    state.internal.acceptHydration(data, session.userId, "team", { ...read });
    expect(state.planning.team().profiles.find(profile => profile.id === "founder")?.weeklyCapacity).toBe(37);
    await Promise.resolve();
    expect(state.planning.team().profiles.find(profile => profile.id === "founder")?.weeklyCapacity).toBe(37);
  } finally { state.internal.dispose(); }
});

test("an initial Team receipt from another session revision cannot expose People", () => {
  const { session, read, data } = fixture();
  const state = createPlanningState({ userId: session.userId, initialSession: { ...session, revision: "session-2" }, initialCurrentProfile: actor, initialWorkspace: "team", initialData: data, initialWorkspaceRead: read, adapter: { saveTask: async task => ({ task }) } });
  try { expect(state.planning.team().profiles).toEqual([]); }
  finally { state.internal.dispose(); }
});
