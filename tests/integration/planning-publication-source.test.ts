import { createHash, randomBytes } from "node:crypto";
import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("selected JSON publication reads its live actor and source together without a second service source dispatch", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const parent = `${prefix}-publication-parent`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`,
    [parent, initiativeId, actors.founder.profileId]);
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const scope = { view: "board", column: "Offen", filters: { query: parent } };
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.model.board.cardIds).toEqual([parent]);
    expect(body.model.board.childProgressById[parent]).toEqual({ completed: 0, total: 0, unfinished: 0, percentage: 0 });
    expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
    // This is a dispatch budget at the real database boundary, not a timing
    // threshold. The complete result still needs a fresh publication check.
    const publication = observed.filter(entry => entry.path.endsWith("/rpc/planning_board_publication_context"));
    expect(publication).toEqual([expect.objectContaining({ actor: "founder", permit: true })]);
    expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_source_version"))).toEqual([]);
    expect(body).not.toHaveProperty("publicationContext");
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  }, "linking");
}, 120_000);

test.each(["ignored", "localOverride"] as const)("a %s profile header preserves the admitted publication path", async mode => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const parent = `${prefix}-profile-header`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`,
    [parent, initiativeId, actors.founder.profileId]);
    if (mode === "localOverride") {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("ENABLE_LOCAL_LOGIN", "true");
    }
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const scope = { view: "board", column: "Offen", filters: { query: parent } };
    const input = request(mode === "localOverride" ? "ceo" : "founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`);
    input.headers.set("host", mode === "localOverride" ? "localhost:3000" : "application.example.test");
    input.headers.set("x-fmd-dev-profile-id", mode === "localOverride" ? actors.founder.profileId : actors.other.profileId);
    const response = await GET(input);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.currentProfile.id).toBe(actors.founder.profileId);
    expect(body.model.board.cardIds).toEqual([parent]);
    expect(body.model.board.childProgressById[parent]).toEqual({ completed: 0, total: 0, unfinished: 0, percentage: 0 });
    expect(body.readAuthority.userId).toBe(mode === "localOverride" ? actors.ceo.userId : actors.founder.userId);
    expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_board_publication_context"))).toHaveLength(mode === "localOverride" ? 0 : 1);
    expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_source_version"))).toHaveLength(mode === "localOverride" ? 1 : 0);
  });
}, 120_000);

test("the atomic publication RPC admits only a mapped live user session and returns its own current role", async () => {
  await withPlanningCredentialDatabase(async ({ db, actors, rpc }) => {
    const revision = (await db.query("select public.planning_source_version() as value")).rows[0].value;
    for (const role of ["ceo", "deputy", "founder", "viewer"] as const) {
      const response = await rpc("planning_board_publication_context", {}, role);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ profile_id: actors[role].profileId, platform_role: role, source_revision: revision });
    }
    for (const role of ["anonymous", "unmapped", "service"] as const) {
      const response = await rpc("planning_board_publication_context", {}, role);
      expect([401, 403]).toContain(response.status);
      expect(await response.json()).not.toHaveProperty("source_revision");
    }
    await db.query("delete from auth.sessions where id=$1", [actors.viewer.sessionId]);
    const revoked = await rpc("planning_board_publication_context", {}, "viewer");
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).not.toHaveProperty("source_revision");
    await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [actors.founder.sessionId]);
    expect((await rpc("planning_board_publication_context", {}, "founder")).status).toBe(403);
  });
}, 120_000);

test.each(["source", "role", "session", "workspace"] as const)("a held complete summary cannot publish after its %s foundation changes", async change => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const parent = `${prefix}-held-publication`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`,
    [parent, initiativeId, actors.founder.profileId]);
    const transport = globalThis.fetch;
    let summaryReady = false;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init), response = await transport(next);
      if (new URL(next.url).pathname.endsWith("/rpc/planning_deliverable_summaries")) {
        expect(response.status).toBe(200);
        const summary = await response.clone().json();
        expect(summary.status).toBe("ready");
        expect(summary.child_progress[parent]).toEqual({ completed: 0, total: 0, unfinished: 0, percentage: 0 });
        summaryReady = true;
        if (change === "source") await db.query("update public.tasks set title='Changed after summary' where id=$1", [parent]);
        if (change === "role") await db.query("update public.profiles set platform_role='viewer' where id=$1", [actors.founder.profileId]);
        if (change === "session") await db.query("delete from auth.sessions where id=$1", [actors.founder.sessionId]);
        if (change === "workspace") await db.query("delete from workspace_private.identity_bindings where user_id=$1", [actors.founder.userId]);
      }
      return response;
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const scope = { view: "board", column: "Offen", filters: { query: parent } };
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    expect(summaryReady).toBe(true);
    expect(response.status).toBe(change === "source" ? 503 : 403);
    const body = await response.json();
    for (const field of ["model", "summaries", "readAuthority", "publicationContext"]) expect(body).not.toHaveProperty(field);
    const publications = observed.filter(entry => entry.path.endsWith("/rpc/planning_board_publication_context"));
    expect(publications).toHaveLength(change === "session" || change === "workspace" ? 0 : 1);
    expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_source_version"))).toEqual([]);
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  }, "linking");
}, 120_000);

test("linking publication requires its original-user Workspace permit, including expiry and revocation", async () => {
  await withPlanningCredentialDatabase(async ({ db, actors, rpc, local, nativeFetch }) => {
    const missing = await rpc("planning_board_publication_context", {}, "founder");
    expect(missing.status).toBe(403);
    expect(await missing.json()).not.toHaveProperty("source_revision");
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    for (const state of ["valid", "expired", "revoked"] as const) {
      const permit = randomBytes(32).toString("base64url"), permitHash = hash(permit);
      try {
        await db.query("select public.workspace_issue_permit($1,$2,$3,'POST','/rpc/planning_board_publication_context',$4)",
          [permitHash, actors.founder.userId, hash(actors.founder.token), actors.founder.sessionId]);
        if (state === "expired") await db.query("update workspace_private.request_permits set expires_at=clock_timestamp()-interval '1 second' where permit_hash=$1", [permitHash]);
        if (state === "revoked") await db.query("delete from workspace_private.request_permits where permit_hash=$1", [permitHash]);
        const response = await nativeFetch(`${local.API_URL}/rest/v1/rpc/planning_board_publication_context`, {
          method: "POST", body: "{}", headers: { apikey: local.ANON_KEY, authorization: `Bearer ${actors.founder.token}`,
            "content-type": "application/json", "x-founderops-workspace-permit": permit },
        });
        expect(response.status).toBe(state === "valid" ? 200 : 403);
        const body = await response.json();
        if (state === "valid") expect(body).toMatchObject({ profile_id: actors.founder.profileId, platform_role: "founder" });
        else expect(body).not.toHaveProperty("source_revision");
      } finally { await db.query("delete from workspace_private.request_permits where permit_hash=$1", [permitHash]); }
    }
  }, "linking");
}, 120_000);

test("an aborted Board delivery starts no new atomic publication dispatch", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const parent = `${prefix}-aborted-publication`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`,
    [parent, initiativeId, actors.founder.profileId]);
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: request("founder", "/api/planning-board-data") }, action: "planning.board.read" });
    expect(permission.ok).toBe(true);
    if (!permission.ok) throw new Error("Synthetic Board authority unavailable");
    const controller = new AbortController();
    const result = await permission.planning.startBoardQuery({ view: "board", filters: { query: parent } }, { signal: controller.signal });
    expect(result.status).toBe("ready");
    if (result.status !== "ready" || !result.delivery) throw new Error("Synthetic Board delivery unavailable");
    const delivery = result.delivery;
    try {
      const [column] = await Promise.all([delivery.columns.Offen!, delivery.summaries!]);
      expect(column.kind).toBe("column");
      const before = observed.filter(entry => entry.path.endsWith("/rpc/planning_board_publication_context")).length;
      expect(before).toBe(1);
      controller.abort();
      const outcome = await delivery.checkPublication(column);
      expect(outcome).toMatchObject({ kind: "failure", status: 503 });
      expect(outcome).not.toHaveProperty("items");
      expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_board_publication_context"))).toHaveLength(before);
    } finally { controller.abort(); delivery.abort(); }
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  }, "linking");
}, 120_000);

test.each(["deadline", "abort"] as const)("a completed atomic publication response cannot publish after original %s", async boundary => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const parent = `${prefix}-held-source`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`,
    [parent, initiativeId, actors.founder.profileId]);
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: request("founder", "/api/planning-board-data") }, action: "planning.board.read" });
    expect(permission.ok).toBe(true);
    if (!permission.ok || !permission.readAuthority) throw new Error("Synthetic original Board authority unavailable");
    const jwt = JSON.parse(Buffer.from(actors.founder.token.split(".")[1], "base64url").toString("utf8"));
    expect(permission.readAuthority.deadline).toBeLessThan(jwt.exp * 1000);
    const transport = globalThis.fetch;
    let reached!: () => void, release!: () => void;
    const held = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init), response = await transport(next);
      if (new URL(next.url).pathname.endsWith("/rpc/planning_board_publication_context")) {
        expect(response.status).toBe(200);
        expect(await response.clone().json()).toMatchObject({ profile_id: actors.founder.profileId, platform_role: "founder" });
        reached(); await gate;
      }
      return response;
    });
    const controller = new AbortController();
    const pending = permission.planning.loadBoard({ view: "board", column: "Offen", filters: { query: parent } }, { signal: controller.signal });
    try {
      await held;
      if (boundary === "deadline") {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(permission.readAuthority.deadline);
        expect(Date.now()).toBeLessThan(jwt.exp * 1000);
      } else controller.abort();
      release();
      const result = await pending;
      expect(result.status).toBe(boundary === "deadline" ? "forbidden" : "unavailable");
      for (const field of ["model", "summaries", "readAuthority"]) expect(result).not.toHaveProperty(field);
      expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_board_publication_context"))).toEqual([
        expect.objectContaining({ actor: "founder", permit: true }),
      ]);
    } finally { release(); await pending; vi.useRealTimers(); controller.abort(); }
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  }, "linking");
}, 120_000);

test("an unavailable atomic publication read fails closed without a service fallback", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const parent = `${prefix}-unavailable-publication`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`,
    [parent, initiativeId, actors.founder.profileId]);
    const transport = globalThis.fetch;
    let failed = false;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init);
      if (new URL(next.url).pathname.endsWith("/rpc/planning_board_publication_context")) {
        failed = true;
        return Response.json({ message: "Synthetic unavailable publication read" }, { status: 503 });
      }
      return transport(next);
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const scope = { view: "board", column: "Offen", filters: { query: parent } };
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    expect(failed).toBe(true);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).not.toHaveProperty("model");
    expect(body).not.toHaveProperty("readAuthority");
    expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_source_version"))).toEqual([]);
  }, "linking");
}, 120_000);
