import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { buildPlanningTaskTableViewModel } from "@/features/planning/model/planning-task-table-view-model";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/model/planning-board-query";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { randomUUID } from "node:crypto";
import * as nextServer from "next/server";
import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { createCalendarLiveFixture } from "./helpers/calendar-live-fixture";
import type { PlanningBoardColumnOutcome, PlanningBoardDelivery } from "@/features/planning/model/planning-board-delivery";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";

type BoardReceipt = ReactElement<{ readId: string; outcome: PlanningBoardColumnOutcome }>;
const { NextRequest } = nextServer;

async function deliveredBoardReceipts(children: ReactNode): Promise<BoardReceipt[]> {
  const child = Children.toArray(children).find(candidate => isValidElement<{ delivery?: PlanningBoardDelivery }>(candidate) && candidate.props.delivery);
  if (!isValidElement(child)) return [];
  async function render(node: ReactNode): Promise<BoardReceipt[]> {
    if (!isValidElement<Record<string, unknown> & { children?: ReactNode }>(node)) return [];
    if (typeof node.props.readId === "string" && node.props.outcome) return [node as BoardReceipt];
    if (typeof node.type === "function") {
      const props = node.props;
      const component = node.type as (input: typeof props) => ReactNode | Promise<ReactNode>;
      return render(await component(props));
    }
    return (await Promise.all(Children.toArray(node.props.children).map(render))).flat();
  }
  // Render only the public server-column subtree, stopping at its client receipts.
  return render(child);
}

it.each([
  { level: "deliverable", status: "Erledigt" }, { level: "deliverable", status: "Offen" },
  { level: "epic", status: "Erledigt" }, { level: "initiative", status: "Pausiert" },
] as const)("authorized $level $status Board HTTP pages keep exact totals beyond the upstream cap and reject foreign continuations", async ({ level, status }) => {
  const fixture = await createCalendarLiveFixture();
  const nativeFetch = globalThis.fetch;
  const prefix = `history-${randomUUID()}`;
  const ssrOpenId = `ssr-${prefix}`;
  const afterCallbacks: Array<() => void> = [];
  let releaseCompletedSSR: (() => void) | undefined;
  let holdCompletedSSR = false;
  let completedSSREntered: (() => void) | undefined;
  let createdProject = false;
  try {
    await fixture.mode("linking");
    const project = await fixture.database.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic Planning') on conflict(id) do nothing returning id");
    createdProject = project.rowCount === 1;
    await fixture.database.query("insert into public.tasks(id,project_id,title,status,priority,task_type) values($1,'findmydoc-founder-execution','Synthetic Epic','Offen','P2','epic')", [`${prefix}-epic`]);
    await fixture.database.query("insert into public.tasks(id,project_id,title,status,priority,task_type,parent_task_id,approval_status) values($1,'findmydoc-founder-execution','Synthetic Initiative','Offen','P2','initiative',$2,'approved')", [`${prefix}-initiative`, `${prefix}-epic`]);
    await fixture.database.query(`insert into public.tasks(id,project_id,title,status,priority,task_type,approval_status,sort_order,parent_task_id)
      select $1 || '-' || lpad(n::text,4,'0'),'findmydoc-founder-execution','Synthetic history ' || n,$2,'P2',$3,$4,n,$5
      from generate_series(1,1027) n`, [prefix, status, level, level === "epic" ? null : "approved", level === "epic" ? null : `${prefix}-${level === "initiative" ? "epic" : "initiative"}`]);
    if (level === "deliverable" && status === "Erledigt") {
      await fixture.database.query("insert into public.tasks(id,project_id,title,status,priority,task_type,parent_task_id,approval_status) values($1,'findmydoc-founder-execution','Synthetic history SSR open','Offen','P2','deliverable',$2,'approved')", [ssrOpenId, `${prefix}-initiative`]);
    }
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: fixture.local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: fixture.local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: fixture.local.SERVICE_ROLE_KEY,
      REQUIRE_SUPABASE_AUTH: "true", GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-history-audience",
      GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic-history@example.test",
      GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu", VERCEL_OIDC_TOKEN: "synthetic-oidc" })) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-sts" });
      if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now() + 3600000).toISOString() });
      if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: true });
      if (url.origin !== new URL(fixture.local.API_URL).origin) throw new Error("Unexpected external provider");
      const selectedRead = holdCompletedSSR && url.pathname === "/rest/v1/rpc/planning_deliverable_column" ? request.clone() : undefined;
      const response = await nativeFetch(request);
      if (selectedRead) {
        const body = await selectedRead.json();
        if (body.p_selected_ids.includes(`${prefix}-0001`)) {
          completedSSREntered?.();
          await new Promise<void>(resolve => { releaseCompletedSSR = resolve; });
        }
      }
      return response;
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const actor = await fixture.actor("viewer");
    vi.stubEnv("VERCEL_OIDC_TOKEN", actor.session.access_token);
    const base = `sb-${new URL(fixture.local.API_URL).hostname.split(".")[0]}-auth-token`;
    const request = (scope?: object, session = actor.session) => new NextRequest(`https://application.example.test/api/planning-board-data${scope ? `?scope=${encodeURIComponent(JSON.stringify(scope))}` : ""}`, { headers: { cookie: `${base}=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}` } });
    const query = { level, column: status, filters: { query: "Synthetic history" }, limit: 1000 };
    const page = { ...query, column: status };
    if (level === "deliverable") {
      const initial = await GET(request({ level, filters: query.filters }));
      expect(initial.status).toBe(200);
      const initialModel = (await initial.json()).model as PlanningWorkspaceModel;
      expect(initialModel.board?.columns.Offen.availability).toBe("ready");
      if (status !== "Offen") expect(initialModel.board?.columns[status]).toMatchObject({ total: null, loaded: 0, availability: "not-loaded" });
    }
    const firstResponse = await GET(request(query));
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()).model as PlanningWorkspaceModel;
    expect(first.board?.columns[status]).toMatchObject({ total: 1027, loaded: 20, completeness: "partial" });
    expect(first.items.filter(item => item.taskType === level)).toHaveLength(20);
    expect(first.taskOmittedFields).toEqual(expect.arrayContaining(["description", "acceptanceCriteria", "definitionOfDone"]));
    expect(first.items.every(item => !("description" in item) && !("acceptanceCriteria" in item) && !("definitionOfDone" in item))).toBe(true);
    if (level === "deliverable" && status === "Erledigt") {
      const legacyResponse = await GET(request());
      expect(legacyResponse.status).toBe(200);
      const legacy = (await legacyResponse.json()).model as PlanningWorkspaceModel;
      expect(legacy.board).toBeUndefined();
      expect(legacy.items.filter(item => item.id.startsWith(prefix) && item.taskType === "deliverable")).toHaveLength(1027);
      const searched = buildPlanningTaskTableViewModel({ currentProfile: null, data: planningWorkspaceModelToPlanningShellState(legacy), filters: { ...DEFAULT_PLANNING_FILTERS, query: "Synthetic history 1027" } });
      expect(searched.visibleTasks.map(item => item.id)).toEqual([`${prefix}-1027`]);
      vi.resetModules();
      const cookie = { name: base, value: `base64-${Buffer.from(JSON.stringify(actor.session)).toString("base64url")}` };
      const { default: PlanningPage } = await importTestModule("src/app/(workspaces)/planning/page.tsx", {
        "server-only": {},
        "next/server": { ...nextServer, after: (callback: () => void) => afterCallbacks.push(callback) },
        "next/headers": { headers: async () => new Headers(), cookies: async () => ({ getAll: () => [cookie], get: (name: string) => name === base ? cookie : undefined, set: () => {} }) },
        "@/features/planning/PlanningApp": { PlanningApp: () => null },
      });
      holdCompletedSSR = true;
      const completedEntered = new Promise<void>(resolve => { completedSSREntered = resolve; });
      const rendering = PlanningPage({ searchParams: Promise.resolve({ "tasks.query": "Synthetic history" }) });
      await completedEntered;
      const page = await rendering;
      expect(page.props.initialWorkspaceRead?.board?.cardIds).toEqual([ssrOpenId]);
      expect(page.props.initialWorkspaceRead?.board?.columns.Offen).toMatchObject({ total: 1, loaded: 1, availability: "ready" });
      expect(page.props.initialWorkspaceRead?.board?.columns.Erledigt).toMatchObject({ total: 1027, loaded: 0, availability: "not-loaded" });
      expect(page.props.initialData.tasks.every((item: object) => !("description" in item) && !("acceptanceCriteria" in item) && !("definitionOfDone" in item))).toBe(true);
      expect(page.props.initialData.tasks).toHaveLength(3);
      expect(page.props.initialWorkspaceRead?.board?.delivery.columns).toContain("Erledigt");
      releaseCompletedSSR!(); holdCompletedSSR = false;
      const receipts = await deliveredBoardReceipts(page.props.children);
      const completed = receipts.find(receipt => receipt.props.outcome.column === "Erledigt");
      expect(completed?.props.readId).toBe(page.props.initialWorkspaceRead?.board?.delivery.id);
      expect(completed?.props.outcome).toMatchObject({ kind: "column", column: "Erledigt", readId: completed?.props.readId,
        scopeRevision: page.props.initialWorkspaceRead?.scopeRevision, queryRevision: page.props.initialWorkspaceRead?.board?.revision,
        observedAt: page.props.initialWorkspaceRead?.board?.observedAt, validUntil: page.props.initialWorkspaceRead?.board?.validUntil ?? null,
        cardIds: first.board?.cardIds, columnState: { total: 1027, loaded: 20, availability: "ready", completeness: "partial", continuation: expect.any(String) } });
      if (completed?.props.outcome.kind !== "column") throw new Error("The completed SSR column must reach its public receipt");
      expect(completed.props.outcome.items).toHaveLength(first.items.length);
      expect(completed.props.outcome.items.filter(item => item.taskType === "deliverable")).toHaveLength(20);
      expect(completed.props.outcome.taskOmittedFields).toEqual(expect.arrayContaining(["description", "acceptanceCriteria", "definitionOfDone"]));
      expect(completed.props.outcome.items.every(item => !("description" in item) && !("acceptanceCriteria" in item) && !("definitionOfDone" in item))).toBe(true);
      const invalid = await PlanningPage({ searchParams: Promise.resolve({ "tasks.query": "Synthetic history", "tasks.status": status, "tasks.review": "bogus", "tasks.sort": "bogus", "tasks.targetFrom": "2026-02-30", "tasks.targetTo": "tomorrow" }) });
      expect(invalid.props.initialWorkspaceRead?.query?.filters).toMatchObject({ review: "Alle", sort: "priority", targetFrom: "", targetTo: "" });
      expect(invalid.props.initialWorkspaceRead?.board?.columns.Erledigt.total).toBe(1027);
      await deliveredBoardReceipts(invalid.props.children);
      expect(afterCallbacks).toHaveLength(2);
      for (const callback of afterCallbacks.splice(0)) callback();
    }
    const continuation = first.board!.columns[status].continuation!;
    const tampered = JSON.parse(Buffer.from(continuation, "base64url").toString("utf8"));
    tampered.offset = 100;
    expect((await GET(request({ ...page, continuation: Buffer.from(JSON.stringify(tampered)).toString("base64url") }))).status).toBe(409);
    expect((await GET(request({ ...page, column: status === "Offen" ? "Review" : "Offen", continuation }))).status).toBe(409);
    expect((await GET(request({ ...page, level: level === "epic" ? "initiative" : "epic", continuation }))).status).toBe(409);
    const nextResponse = await GET(request({ ...page, continuation }));
    expect(nextResponse.status).toBe(200);
    const next = (await nextResponse.json()).model as PlanningWorkspaceModel;
    expect(next.board?.cardIds).toHaveLength(20);
    expect(next.board?.cardIds.some(id => first.board!.cardIds.includes(id))).toBe(false);
    const other = await fixture.actor("viewer");
    expect((await GET(request({ ...page, continuation }, other.session))).status).toBe(409);
    expect((await GET(request({ ...page, continuation, filters: { query: "Different search" } }))).status).toBe(409);
    const searched = await GET(request({ level, column: status, filters: { query: "Synthetic history 1027" } }));
    expect(searched.status).toBe(200);
    expect((await searched.json()).model.board.cardIds).toEqual([`${prefix}-1027`]);
    await fixture.database.query("delete from auth.sessions where id=$1", [actor.sessionId]);
    expect((await GET(request({ ...page, continuation }))).status).toBe(401);
    expect((await fixture.database.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actor.userId])).rows[0].remaining).toBe(0);
  } finally {
    releaseCompletedSSR?.();
    for (const callback of afterCallbacks.splice(0)) callback();
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await fixture.database.query("begin");
    await fixture.database.query("select set_config('founderops.trash_lifecycle_write','on',true)");
    await fixture.database.query("delete from public.tasks where id like $1 or id=$2", [`${prefix}%`, ssrOpenId]);
    await fixture.database.query("commit");
    if (createdProject) await fixture.database.query("delete from public.projects where id='findmydoc-founder-execution'");
    await fixture.close();
  }
}, 120_000);
