import { afterEach, expect, test, vi } from "vitest";
import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
const ada = { id: "ada", name: "Ada", platformRole: "founder" as const, orgRole: "Engineering", githubLogin: "ada", weeklyCapacity: 20, notificationsEnabled: true };
const bea = { ...ada, id: "bea", name: "Bea" };
afterEach(() => vi.unstubAllGlobals());
test("actual supporting coverage preserves partial Team membership and accepts a proven complete empty scope", async () => {
  const browser = createBrowserPlanningState({ initialUserId: "user", initialWorkspace: "team", initialCurrentProfile: { id: ada.id, name: ada.name, platformRole: ada.platformRole, githubLogin: ada.githubLogin }, initialData: { ...emptyPlanningShellState, profiles: [ada, bea] }, initialHeaderData: emptyPlanningHeaderData });
  browser.runtime.session = { userId: "user", revision: "same", expiresAt: 4102444800, user: { id: "user" } };
  let complete = false;
  browser.runtime.apiClient = { ...browser.runtime.apiClient, requestJson: async <T,>() => ({ response: new Response(null), body: { model: { revision: "read", people: complete ? [] : [{ ...ada, notificationsEnabled: false }], items: [], readCoverage: { people: complete ? "complete" : "partial", items: "partial" } } } as T }) };
  await browser.owner.planning.refreshWorkspace("team");
  expect(browser.owner.planning.team()).toMatchObject({ completeness: "partial", profiles: [{ id: ada.id, notificationsEnabled: true }, { id: bea.id }] });
  complete = true;
  await browser.owner.planning.refreshWorkspace("team");
  expect(browser.owner.planning.team()).toMatchObject({ completeness: "complete", profiles: [] });
});
