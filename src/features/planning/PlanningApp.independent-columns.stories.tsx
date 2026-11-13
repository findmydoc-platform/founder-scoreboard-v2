import type { User } from "@supabase/supabase-js";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState } from "react";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { planningWorkspaceHydration } from "./model/planning-workspace-hydration";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn, type PlanningBoardQueryInput } from "./model/planning-board-query";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { Profile, TaskStatus } from "@/lib/types";
import { taskStatuses } from "@/lib/status";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { mockAccountLifecycle } from "../../../tests/helpers/account-lifecycle-browser-fixture";

const profile: Profile = { id: "independent-person", name: "Synthetic Person", platformRole: "ceo", orgRole: "CEO", githubLogin: "", weeklyCapacity: 40 };
const user = { id: "independent-user", email: "independent@example.test" } as User;
const session = { user, userId: user.id, revision: "independent-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
const open = taskDetailStoryTask({ id: "independent-open", title: "Synthetic ready open card", status: "Offen", assigneeId: profile.id, ownerId: profile.id });
const review = taskDetailStoryTask({ id: "independent-review", title: "Synthetic independently usable review", status: "Review", assigneeId: profile.id, ownerId: profile.id });
function page(input: PlanningBoardQueryInput = {}): PlanningWorkspaceModel {
  const query = normalizePlanningBoardQuery(input), column = input.column || "Offen";
  const cards = column === "Offen" ? [open] : column === "Review" ? [review] : [];
  const columns = Object.fromEntries([...taskStatuses, "Pausiert"].map(status => [status, { total: status === column ? cards.length : null, loaded: status === column ? cards.length : 0, availability: status === column ? "ready" : "not-loaded", completeness: status === column ? "complete" : "partial", continuation: null } satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>;
  return { revision: "independent-source", scopeRevision: "42", query, project: emptyPlanningShellState.project, items: cards, people: [profile], sprints: [], relationships: [], blockers: [], preferences: [], coverage: { items: "partial", people: "complete", sprints: "complete", relationships: "partial", blockers: "partial", preferences: "complete" },
    board: { query, column, queryKey: planningBoardQueryKey(query), revision: "independent-source", observedAt: "2026-11-13T12:00:00Z", cardIds: cards.map(card => card.id), columns, metrics: { total: 2, open: 2, done: 0, blocked: null }, childProgressById: Object.fromEntries(cards.map(card => [card.id, null])), attentionById: Object.fromEntries(cards.map(card => [card.id, null])), viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 2, latestUpdatedAt: "independent-source" } },
  };
}
const initial = page();

// HTTP delivery is controlled here. Real selection and Auth have separate
// disposable integration coverage; this flow verifies rendered interaction.
function IndependentColumnsFlow({ failEarlier = false }: { failEarlier?: boolean }) {
  const [ready, setReady] = useState(false), [release, setRelease] = useState<(() => void) | null>(null), [delivered, setDelivered] = useState(false), [attempts, setAttempts] = useState(0), [hiddenReads, setHiddenReads] = useState(0);
  useEffect(() => {
    const key = `founderops.product-updates.seen.${profile.id}`, previous = localStorage.getItem(key);
    localStorage.setItem(key, JSON.stringify(productUpdates.map(update => update.id)));
    let completePending: ((response: Response) => void) | undefined;
    const restore = mockAccountLifecycle("google", { linked: true }, input => {
      const url = new URL(String(input), "http://localhost:3000");
      if (url.pathname === "/api/auth/session") return Response.json({ session });
      if (url.pathname === "/api/planning-source-version") return Response.json({ version: "42" });
      if (url.pathname === "/api/planning-board-data") {
        const query = JSON.parse(url.searchParams.get("scope") || "{}");
        if (query.column === "Pausiert") setHiddenReads(value => value + 1);
        if (query.column === "In Arbeit") {
          setAttempts(value => value + 1);
          return new Promise<Response>(resolve => {
            completePending = resolve;
            setRelease(() => () => {
              resolve(failEarlier ? Response.json({ error: "Synthetic earlier column unavailable" }, { status: 503 }) : Response.json({ model: page(query), readAuthority: { userId: user.id, deadline: session.expiresAt * 1000 }, currentProfile: profile }));
              completePending = undefined; setDelivered(true);
            });
          });
        }
        return Response.json({ model: page(query), readAuthority: { userId: user.id, deadline: session.expiresAt * 1000 }, currentProfile: profile });
      }
      if (url.pathname === "/api/github-app/status") return Response.json({ installation: { available: false }, user: { connected: false } });
      if (url.pathname === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [] });
      return Response.json({ error: "Synthetic optional area unavailable" }, { status: 503 });
    });
    queueMicrotask(() => setReady(true));
    return () => { completePending?.(Response.json({ error: "Flow ended" }, { status: 503 })); restore(); if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous); };
  }, [failEarlier]);
  return <><button type="button" disabled={!release || delivered} onMouseDown={event => event.preventDefault()} onClick={() => release?.()}>Frühere Antwort liefern</button><button type="button">Interaktion abschließen</button><output aria-label="Frühere Antwort">{delivered ? "empfangen" : "ausstehend"}</output><output aria-label="Frühere Leseversuche">{attempts}</output><output aria-label="Versteckte Spaltenabrufe">{hiddenReads}</output>{ready ? <PlanningStateProvider><PlanningApp initialWorkspace="planning" initialWorkspaceRead={planningWorkspaceHydration("planning", initial, session, { userId: user.id, deadline: session.expiresAt * 1000 })} initialData={{ ...emptyPlanningShellState, tasks: [...initial.items], profiles: [profile] }} initialHeaderData={emptyPlanningHeaderData} initialAuthUser={user} initialCurrentProfile={profile} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider> : null}</>;
}
const meta = { title: "Planning/Independent column reveal", component: IndependentColumnsFlow, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } } } satisfies Meta<typeof IndependentColumnsFlow>;
export default meta;
type Story = StoryObj<typeof meta>;

async function operateLaterCard(canvasElement: HTMLElement, failed: boolean) {
  const canvas = within(canvasElement), title = await canvas.findByRole("link", { name: review.title });
  const card = title.closest("article")!, board = canvas.getByRole("region", { name: "Board nach Status" });
  const earlier = board.querySelector<HTMLElement>('[data-board-column-status="In Arbeit"]')!;
  await expect(earlier).toHaveAttribute("data-collapsed", "false");
  await expect(within(earlier).getByText("In Arbeit wird geladen …")).toBeVisible();
  await expect(within(card).getByText("Kindfortschritt unbekannt")).toBeVisible();
  await expect(within(card).getByText("Signale unbekannt")).toBeVisible();
  const control = within(card).getByRole("button", { name: `Status für ${review.title} ändern` });
  await userEvent.click(control); await userEvent.keyboard("{Escape}");
  await expect(control).toHaveFocus();
  board.scrollTo({ left: 420 });
  await waitFor(() => expect(board.scrollLeft).toBeGreaterThan(0));
  const left = card.getBoundingClientRect().left, top = card.getBoundingClientRect().top, scroll = board.scrollLeft, pageTop = window.scrollY;
  fireEvent.click(canvas.getByRole("button", { name: "Frühere Antwort liefern" }));
  await expect(canvas.getByLabelText("Frühere Antwort")).toHaveTextContent("empfangen");
  if (failed) await within(earlier).findByRole("alert");
  else await within(earlier).findByText("Die Ergebnisliste hat sich geändert. Der angezeigte Stand ist veraltet.");
  await expect(control).toHaveFocus();
  await expect(earlier).toHaveAttribute("data-collapsed", "false");
  await expect(Math.abs(card.getBoundingClientRect().left - left)).toBeLessThan(1);
  await expect(Math.abs(card.getBoundingClientRect().top - top)).toBeLessThan(1);
  await expect(board.scrollLeft).toBe(scroll); await expect(window.scrollY).toBe(pageTop);
  await userEvent.click(canvas.getByRole("button", { name: "Interaktion abschließen" }));
  if (!failed) await waitFor(() => expect(earlier).toHaveAttribute("data-collapsed", "true"));
  else await expect(earlier).toHaveAttribute("data-collapsed", "false");
  await expect(canvas.getByLabelText("Frühere Leseversuche")).toHaveTextContent("1");
  await expect(canvas.getByLabelText("Versteckte Spaltenabrufe")).toHaveTextContent("0");
  await expect(canvas.getByRole("link", { name: review.title })).toBeInTheDocument();
}
export const EarlierEmptyWaitsForCardInteraction: Story = { play: async ({ canvasElement }) => operateLaterCard(canvasElement, false) };
export const EarlierFailureKeepsLaterCardUsable: Story = { args: { failEarlier: true }, play: async ({ canvasElement }) => operateLaterCard(canvasElement, true) };
