import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/model/planning-board-query";

test("saved Table SSR forwards cancellation during pending SDK IO and rejects its late successful selection", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const rowId = `${prefix}-native-table-lifetime`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`, [rowId, initiativeId, actors.founder.profileId]);
    await db.query("insert into public.profile_ui_preferences(profile_id,default_task_view,planning_filters) values($1,'table',$2)", [actors.founder.profileId, { ...DEFAULT_PLANNING_FILTERS, query: rowId }]);
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: request("founder", "/api/planning-board-data") }, action: "planning.board.read" });
    expect(permission.ok).toBe(true);
    if (!permission.ok) throw new Error("Synthetic Table SSR authority unavailable");
    const transport = globalThis.fetch;
    let reached!: () => void, release!: () => void, sdkPending = false, cancelledWhilePending = false;
    const held = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!url.pathname.endsWith("/rpc/planning_deliverable_selection")) return transport(input, init);
      // Observe the original explicit SDK signal while this fetch invocation is
      // unresolved. A completed/copied Request signal is not the oracle.
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const signal = init!.signal!;
      sdkPending = true;
      const cancelled = () => { if (sdkPending) cancelledWhilePending = true; };
      signal.addEventListener("abort", cancelled, { once: true });
      try {
        const response = await transport(input, init);
        expect(response.status).toBe(200);
        expect(await response.clone().json()).toMatchObject({ status: "ready", card_ids: [rowId] });
        reached(); await gate;
        return response;
      } finally { sdkPending = false; signal.removeEventListener("abort", cancelled); }
    });
    const controller = new AbortController();
    // Empty input takes the new stored-Table branch inside the native query
    // entry, rather than the explicit Table shortcut or an artificial Board.
    const pending = permission.planning.startBoardQuery({}, { signal: controller.signal });
    try {
      await Promise.race([held, pending.then(() => { throw new Error("Table SSR completed before its held selection"); })]);
      expect(sdkPending).toBe(true);
      const beforeAbort = observed.length;
      controller.abort();
      expect(cancelledWhilePending).toBe(true);
      release();
      const result = await pending;
      expect(result.status).toBe("unavailable");
      for (const field of ["model", "delivery", "readAuthority"]) expect(result).not.toHaveProperty(field);
      expect(observed.slice(beforeAbort).some(entry => entry.path.endsWith("/rpc/planning_board_publication_context"))).toBe(false);
    } finally { release(); await pending; controller.abort(); }
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  }, "linking");
}, 120_000);
