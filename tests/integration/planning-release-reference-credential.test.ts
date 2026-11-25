import { createHash, randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

const mocks = { "server-only": {}, "next/cache": { unstable_cache: (load: unknown) => load, revalidateTag() {} } };
const endpoint = "/api/team/platform-releases/v1/releases";

it("returns complete authorized PR matches and their lineage beyond the Data API row limit", () => withPlanningCredentialDatabase(async f => {
  const { GET } = await importTestModule("src/app/api/team/platform-releases/v1/releases/route.ts", mocks);
  const version = `v9.${Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 7), 16)}.0`;
  const manifestDigest = createHash("sha256").update(version).digest("hex");
  const prefix = f.prefix + "-release-";
  const owner = f.actors.founder.profileId, otherProject = prefix + "secondary", ancestor = prefix + "ancestor";
  const issue = (number: number) => ({ repository: " FiNdMyDoc-Platform/MANAGEMENT ", number });
  const pull = (number: number, issues: ReturnType<typeof issue>[]) => ({ repository: " Example/Release ", number, issues });
  const manifest = { schemaVersion: 2, version, manifestDigest, highlights: [], changes: [],
    components: [{ pullRequests: [pull(12, [issue(31)]), pull(13, [issue(31), issue(32)]), pull(14, [])] }] };
  await f.db.query("insert into public.projects(id,name) values($1,'Additional authorized project')", [otherProject]);
  try {
    await f.db.query(`insert into public.platform_releases(version,schema_version,summary,published_at,plan_digest,content_digest,manifest_digest,manifest)
      values($1,2,'Synthetic release',now(),$2,$2,$2,$3)`, [version, manifestDigest, manifest]);
    await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,owner)
      values($1,$2,'Off-project ancestor','initiative','Offen','P2','approved',$3)`, [ancestor, otherProject, owner]);
    await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,github_repo,github_issue_number)
      select $1 || 'direct-' || lpad(n::text,4,'0'), $2, 'Direct ' || n, 'deliverable','Offen','P2','approved',$3,$4,null,null
      from generate_series(1,1005) n
      union all select $1 || 'issue-31', $2, 'Issue 31','deliverable','Offen','P2','approved',$3,$4,' example/RELEASE ',31
      union all select $1 || 'issue-32', $2, 'Issue 32','deliverable','Offen','P2','approved',$3,$4,'EXAMPLE/release',32`,
    [prefix, otherProject, ancestor, owner]);
    await f.db.query(`insert into public.task_links(task_id,type,label,url,metadata)
      select id,'github_pull_request','PR 12','https://github.com/example/release/pull/12',
        jsonb_build_object('repository',' EXAMPLE/release ','number','0012')
      from public.tasks where id like $1 order by id`, [prefix + "direct-%"]);
    await f.db.query(`insert into public.task_links(task_id,type,label,url,metadata)
      values ($1,'github_pull_request','Duplicate','https://github.com/example/release/pull/12','{"repository":"example/release","number":12}')`, [prefix + "direct-0001"]);

    const url = `${endpoint}?area=references&version=${version}&manifestDigest=${manifestDigest}`;
    const response = await GET(f.request("viewer", url));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ ok: true, version, manifestDigest, readActor: { profileId: f.actors.viewer.profileId, platformRole: "viewer" } });
    const [direct, fallback, missing] = payload.planningReferences;
    expect(direct.pullRequestNumber).toBe(12);
    const ids = direct.taskLinks.map((item: { id: string }) => item.id);
    expect(ids).toHaveLength(1006);
    expect(new Set(ids).size).toBe(1006);
    expect(ids.slice(0, 2)).toEqual([prefix + "direct-0001", ancestor]);
    expect(ids.at(-1)).toBe(prefix + "direct-1005");
    expect(fallback.taskLinks.map((item: { id: string }) => item.id)).toEqual([prefix + "issue-31", ancestor, prefix + "issue-32"]);
    expect(missing).toMatchObject({ pullRequestNumber: 14, taskLinks: [] });
    const referenceOperations = () => f.observed.filter(event =>
      ["/rest/v1/rpc/planning_release_reference_snapshot", "/rest/v1/rpc/platform_release_reference_publication_context"].includes(event.path));
    expect(referenceOperations()).toMatchObject([
      { path: "/rest/v1/rpc/planning_release_reference_snapshot", actor: null },
      { path: "/rest/v1/rpc/platform_release_reference_publication_context", actor: "viewer" },
    ]);
    const observed = await GET(f.request("viewer", `${endpoint}?area=reference-source`));
    expect(observed.status).toBe(200);
    expect(await observed.json()).toMatchObject({ sourceRevision: payload.sourceRevision, readActor: payload.readActor });
    expect(f.observed.filter(event => event.path === "/rest/v1/rpc/planning_release_reference_snapshot")).toHaveLength(1);
    expect(f.observed.filter(event => ["/rest/v1/task_links", "/rest/v1/active_tasks"].includes(event.path))).toEqual([]);
    expect((await GET(f.request("unmapped", url))).status).toBe(403);
    const stale = await GET(f.request("viewer", url.replace(manifestDigest, "0".repeat(64))));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_manifest" });

    await f.db.query("update public.tasks set title='Current ancestor' where id=$1", [ancestor]);
    const changed = await (await GET(f.request("viewer", url))).json();
    expect(changed.sourceRevision).not.toBe(payload.sourceRevision);
    expect(changed.planningReferences[0].taskLinks[1]).toMatchObject({ id: ancestor, title: "Current ancestor" });
    const actor = f.actors.viewer;
    const directCall = {
      p_user_id: actor.userId, p_session_id: actor.sessionId,
      p_profile_id: actor.profileId, p_platform_role: "viewer",
      p_deadline: new Date(Date.now() + 60_000).toISOString(),
      p_release_keys: [{ version, manifestDigest }],
    };
    for (const role of ["anonymous", "viewer"] as const) {
      expect([401, 403]).toContain((await f.rpc("planning_release_reference_snapshot", directCall, role)).status);
    }
    expect(await (await f.rpc("planning_release_reference_snapshot", { ...directCall, p_session_id: f.actors.ceo.sessionId })).json())
      .toEqual({ status: "forbidden" });
    // Revoke only after the actual protected snapshot completed, before publication.
    const providerFetch = globalThis.fetch;
    let returnedReady = false;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const result = await providerFetch(request);
      if (new URL(request.url).pathname === "/rest/v1/rpc/planning_release_reference_snapshot") {
        returnedReady = (await result.clone().json()).status === "ready";
        await f.db.query("delete from auth.sessions where id=$1", [actor.sessionId]);
      }
      return result;
    });
    const revoked = await GET(f.request("viewer", url));
    expect(returnedReady).toBe(true);
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).not.toHaveProperty("planningReferences");
    expect(await (await f.rpc("planning_release_reference_snapshot", directCall)).json()).toEqual({ status: "forbidden" });
  } finally {
    await f.db.query("delete from public.platform_releases where version=$1", [version]);
    await f.db.query("select set_config('founderops.trash_lifecycle_write','on',false)");
    await f.db.query("delete from public.tasks where project_id=$1", [otherProject]);
    await f.db.query("delete from public.projects where id=$1", [otherProject]);
  }
}, "linking"), 120_000);

it("stops a complete ancestor traversal at a cycle or a deliberately absent active ancestor", () => withPlanningCredentialDatabase(async f => {
  const { GET } = await importTestModule("src/app/api/team/platform-releases/v1/releases/route.ts", mocks);
  const version = `v8.${Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 7), 16)}.0`;
  const manifestDigest = createHash("sha256").update(version).digest("hex");
  const prefix = f.prefix + "-lineage-";
  const cycle = prefix + "deliverable", subIssue = prefix + "sub-issue", absent = prefix + "absent-ancestor";
  const owner = f.actors.founder.profileId;
  const manifest = { schemaVersion: 2, version, manifestDigest, highlights: [], changes: [], components: [{
    pullRequests: [{ repository: "example/release", number: 21, issues: [] }, { repository: "example/release", number: 22, issues: [] }],
  }] };
  try {
    await f.db.query(`insert into public.platform_releases(version,schema_version,summary,published_at,plan_digest,content_digest,manifest_digest,manifest)
      values($1,2,'Traversal fixture',now(),$2,$2,$2,$3)`, [version, manifestDigest, manifest]);
    await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner)
      values($1,'findmydoc-founder-execution','Cycle deliverable','deliverable','Offen','P2','approved',$4,$5),
        ($2,'findmydoc-founder-execution','Cycle sub-issue','sub_issue','Offen','P2','approved',$1,$5),
        ($3,'findmydoc-founder-execution','Hidden ancestor child','deliverable','Offen','P2','approved',$4,$5)`,
    [cycle, subIssue, absent, f.initiativeId, owner]);
    // The current command guard prevents these older inconsistent relationships.
    // Install only these fixture relationships before the normal read and PR-link writes.
    await f.db.query("begin");
    try {
      await f.db.query("set local session_replication_role = replica");
      await f.db.query("update public.tasks set parent_task_id=$2 where id=$1", [cycle, subIssue]);
      await f.db.query(`update public.tasks set trashed_at=now(),trashed_by=$2,trash_reason='Synthetic inactive ancestor',
        trash_cause='withdrawn',purge_after=now()+interval '90 days',trash_root_type='initiative',trash_root_id=id,trash_revision=1
        where id=$1`, [f.initiativeId, f.actors.ceo.profileId]);
      await f.db.query("commit");
    } catch (error) {
      await f.db.query("rollback");
      throw error;
    }
    await f.db.query(`insert into public.task_links(task_id,type,label,url,metadata)
      values ($1,'github_pull_request','21','https://github.com/example/release/pull/21','{"repository":"example/release","number":21}'),
        ($2,'github_pull_request','22','https://github.com/example/release/pull/22','{"repository":"example/release","number":22}')`, [cycle, absent]);
    const url = `${endpoint}?area=references&version=${version}&manifestDigest=${manifestDigest}`;
    const result = await GET(f.request("viewer", url));
    expect(result.status).toBe(200);
    expect((await result.json()).planningReferences.map((reference: { taskLinks: { id: string }[] }) =>
      reference.taskLinks.map(link => link.id))).toEqual([[cycle, subIssue], [absent]]);
  } finally {
    await f.db.query("delete from public.platform_releases where version=$1", [version]);
  }
}, "linking"), 90_000);
