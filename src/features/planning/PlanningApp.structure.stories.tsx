import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { usePlanningAppController } from "./hooks/use-planning-app-controller";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { PlanningTaskViewRenderer } from "./organisms/planning-task-view-renderer";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { itemPageProfile, itemPageUser, itemPageHeaderData, mockItemPageBrowser } from "../../../tests/helpers/task-detail-page-browser-fixture";
const parent = taskDetailStoryTask({ id: "controller-structure-parent", taskType: "initiative", title: "Controller Initiative", description: "Current controller description", updatedAt: "2026-11-01T12:00:00Z" });
const child = taskDetailStoryTask({ id: "controller-structure-child", parentTaskId: parent.id, title: "Controller Deliverable", updatedAt: parent.updatedAt });
function Controller() {
  const controller = usePlanningAppController({ initialData: { ...emptyPlanningShellState, profiles: [itemPageProfile] }, initialHeaderData: itemPageHeaderData, initialWorkspace: "planning", source: "supabase", authRequired: true, initialAuthUser: itemPageUser, initialCurrentProfile: itemPageProfile, initialProtectedDataLoaded: true });
  return <><button onClick={() => controller.setView("structure")}>Strukturansicht öffnen</button><button onClick={() => void controller.planningState.refreshWorkspace("planning")}>Sichtbare Struktur aktualisieren</button><PlanningTaskViewRenderer controller={controller} /></>;
}
function StructureControllerFlow() {
  const [ready, setReady] = useState(false), [counts, setCounts] = useState({ roots: 0, children: 0, complete: 0 });
  useEffect(() => {
    let active = true, restore: (() => void) | undefined;
    void mockItemPageBrowser({ respond: input => {
      const url = new URL(String(input), "http://localhost:3000");
      if (url.pathname !== "/api/planning-board-data") return undefined;
      const query = JSON.parse(url.searchParams.get("scope") || "{}");
      if (query.view !== "structure") {
        if (query.view === "complete") setCounts(value => ({ ...value, complete: value.complete + 1 }));
        return Response.json({ error: "Unselected planning class" }, { status: 503 });
      }
      if (query.area === "controls") {
        const deadline = Date.now() + 60_000;
        return Response.json({ readAuthority: { userId: itemPageUser.id, deadline }, readActor: { profileId: itemPageProfile.id, platformRole: itemPageProfile.platformRole }, model: { revision: "controller-structure-source", controls: {
          people: [{ id: itemPageProfile.id, name: itemPageProfile.name }], sprints: [], initiatives: [{ id: parent.id, title: parent.title }], workstreams: [], coverage: "complete", sourceRevision: "controller-structure-source", scopeRevision: "controls", observedAt: "2026-11-01T12:00:00Z", validUntil: new Date(deadline).toISOString(),
        } } });
      }
      const roots = query.area === "roots";
      setCounts(value => ({ ...value, [roots ? "roots" : "children"]: value[roots ? "roots" : "children"] + 1 }));
      const deadline = Date.now() + 60_000, row = roots ? parent : child;
      return Response.json({ readAuthority: { userId: itemPageUser.id, deadline }, readActor: { profileId: itemPageProfile.id, platformRole: itemPageProfile.platformRole }, model: {
        revision: "controller-structure-source", items: roots ? [parent] : [child, parent], people: [itemPageProfile], taskOmittedFields: [],
        structure: { query, itemIds: [row.id], contextIds: roots ? [] : [parent.id], total: 1, coverage: "complete", continuation: null, sourceRevision: "controller-structure-source", scopeRevision: query.area,
          observedAt: "2026-11-01T12:00:00Z", validUntil: new Date(deadline).toISOString() },
      } });
    } }).then(cleanup => { if (!active) cleanup(); else { restore = cleanup; setReady(true); } });
    return () => { active = false; restore?.(); };
  }, []);
  return <>{Object.entries(counts).map(([key, value]) => <output key={key} aria-label={`Controller-Strukturabfragen ${key}`}>{value}</output>)}{ready ? <PlanningStateProvider><Controller /></PlanningStateProvider> : null}</>;
}
const meta = { component: StructureControllerFlow, title: "Planning/Selected Structure controller", parameters: { nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } } } satisfies Meta<typeof StructureControllerFlow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ActualControllerUsesOnlyMountedRootsAndOpenedParentClassesOnRefresh: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Strukturansicht öffnen" }));
    await waitFor(() => expect(canvas.getByLabelText("Controller-Strukturabfragen roots")).toHaveTextContent("1"));
    const parentButton = await canvas.findByRole("button", { name: /Controller Initiative/ });
    await expect(parentButton).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.getByLabelText("Controller-Strukturabfragen complete")).toHaveTextContent("0");
    await expect(canvas.getByLabelText("Controller-Strukturabfragen children")).toHaveTextContent("0");
    await userEvent.click(parentButton); await expect(await canvas.findByRole("link", { name: "Controller Deliverable" })).toHaveAttribute("href", `/tasks/${child.id}`);
    await userEvent.click(canvas.getByRole("button", { name: "Sichtbare Struktur aktualisieren" }));
    await waitFor(() => expect(canvas.getByLabelText("Controller-Strukturabfragen roots")).toHaveTextContent("2"));
    await waitFor(() => expect(canvas.getByLabelText("Controller-Strukturabfragen children")).toHaveTextContent("2"));
    await userEvent.click(parentButton);
    await userEvent.click(canvas.getByRole("button", { name: "Sichtbare Struktur aktualisieren" }));
    await waitFor(() => expect(canvas.getByLabelText("Controller-Strukturabfragen roots")).toHaveTextContent("3"));
    await expect(canvas.getByLabelText("Controller-Strukturabfragen children")).toHaveTextContent("2");
    await expect(canvas.getByLabelText("Controller-Strukturabfragen complete")).toHaveTextContent("0");
  },
};
