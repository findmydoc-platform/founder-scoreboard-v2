import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

type Fixture = Parameters<Parameters<typeof withPlanningCredentialDatabase>[0]>[0];
const basisRpc = "planning_deliverable_review_basis";
const commandRpc = "decide_planning_review_from_basis";

async function seed(f: Fixture) {
  const target = f.prefix + "-review", sibling = f.prefix + "-other-review";
  const child = f.prefix + "-evidence", sprint = f.prefix + "-sprint";
  const reviewer = f.actors.founder.profileId;
  await f.db.query(`insert into public.sprints(id,project_id,name,start_date,end_date,review_due_at)
    values($1,'findmydoc-founder-execution','Review Sprint','2000-01-01','2099-12-31',now()+interval '12 minutes')`, [sprint]);
  for (const id of [target, sibling]) {
    await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,
      review_status,review_owner_profile_id,review_requested_at,sprint_id)
      values($1,'findmydoc-founder-execution','Review target','deliverable','Offen','P2','approved',$2,$3,'not_requested',$4,null,$5)`,
    [id, f.initiativeId, f.actors.other.profileId, reviewer, sprint]);
  }
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,parent_task_id,owner,sort_order)
    select $1||'-empty-'||n,'findmydoc-founder-execution','Earlier child','sub_issue','Offen','P2',$2,$3,n
    from generate_series(1,25) n`, [f.prefix, target, reviewer]);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,parent_task_id,owner,sort_order)
    values($1,'findmydoc-founder-execution','Child evidence','sub_issue','Offen','P2',$2,$3,26)`, [child, target, reviewer]);
  await f.db.query(`insert into public.task_links(task_id,type,label,url,metadata) values
    ($1,'github_pull_request','Reviewed change','https://github.com/example/repo/pull/7','{"repository":"example/repo","number":7,"status":"merged","mergedAt":"2026-11-04T09:00:00Z"}'),
    ($2,'evidence','Unrelated','https://example.invalid/unrelated','{}')`, [child, sibling]);
  await f.db.query("update public.tasks set status='Review',review_status='requested',review_requested_at=now() where id=any($1)", [[target, sibling]]);
  const route = await importTestModule("src/app/api/tasks/[id]/review/route.ts", { "server-only": {} });
  const request = (actor: keyof Fixture["actors"] = "founder", id = target) => f.request(actor, `/api/tasks/${id}/review`);
  const read = (actor: keyof Fixture["actors"] = "founder", id = target) => route.GET(request(actor, id), { params: Promise.resolve({ id }) });
  const payload = {
    decision: "changes_requested", comment: "Please complete the checked evidence.",
    checklist: { acceptanceCriteriaMet: false, evidenceProvided: false, communicationClear: false, blockerHandled: false },
  };
  const decide = (actor: keyof Fixture["actors"], basis?: { taskUpdatedAt: string; decision: { token: string } }, decisionBasis = basis?.decision.token) =>
    route.POST(f.request(actor, `/api/tasks/${target}/review`, "POST", { ...payload,
      ...(basis ? { expectedUpdatedAt: basis.taskUpdatedAt } : {}), ...(decisionBasis === undefined ? {} : { decisionBasis }),
    }), { params: Promise.resolve({ id: target }) });
  return { target, sibling, child, sprint, read, decide };
}

test("one opened Review uses exact inherited evidence and the original user, independently of the unrelated entries", () => withPlanningCredentialDatabase(async f => {
  const { target, sibling, child, sprint, read } = await seed(f);
  const first = await read();
  expect(first.status).toBe(200);
  const { basis } = await first.json();
  expect(basis).toMatchObject({ taskId: target,
    evidence: { status: "present", hasException: false, exceptionNote: null, links: [{
      taskId: child, title: "Child evidence", url: "https://github.com/example/repo/pull/7", kind: "github_pull_request",
      pullRequest: { title: "Reviewed change", repository: "example/repo", number: 7, status: "merged", mergedAt: "2026-11-04T09:00:00Z" },
    }] }, sprintLock: { sprintId: sprint, locked: false },
    decision: { status: "allowed", token: expect.any(String) },
    readActor: { profileId: f.actors.founder.profileId, platformRole: "founder" },
    readAuthority: { userId: f.actors.founder.userId },
  });
  expect(basis.evidence.links).toHaveLength(1);
  expect(f.observed.filter(row => row.path === "/rest/v1/rpc/planning_board_publication_context").map(row => row.actor)).toEqual(["founder"]);
  expect(f.observed.filter(row => row.path === "/rest/v1/rpc/" + basisRpc)).toHaveLength(1);
  expect(f.observed.filter(row => ["/rest/v1/active_tasks", "/rest/v1/tasks"].includes(row.path))).toEqual([]);
  expect(await (await read("founder", sibling)).json()).toMatchObject({ basis: { evidence: { links: [{ taskId: sibling }] } } });
  for (const actor of ["ceo", "deputy"] as const) expect((await read(actor)).status).toBe(200);
  for (const actor of ["other", "viewer", "unmapped"] as const) {
    const res = await read(actor);
    expect(res.status).toBe(403);
    expect(await res.json()).not.toHaveProperty("basis");
  }
  expect((await read("ceo", child)).status).toBe(404);
  expect((await read("ceo", f.prefix + "-not-present")).status).toBe(404);

  const providerFetch = globalThis.fetch;
  let race = true;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (race && new URL(request.url).pathname.endsWith("/planning_board_publication_context")) {
      race = false;
      await f.db.query("update public.task_links set label='Changed while reading' where task_id=$1", [child]);
    }
    return providerFetch(request);
  });
  const mismatched = await read();
  expect(mismatched.status).toBe(409);
  expect(await mismatched.json()).toMatchObject({ code: "stale_review_basis" });
  vi.stubGlobal("fetch", providerFetch);
  await f.db.query("update public.sprints set end_date=null where id=$1", [sprint]);
  const missingTemporalSupport = await read();
  expect(missingTemporalSupport.status).toBe(503);
  expect(await missingTemporalSupport.json()).not.toHaveProperty("basis");
  await f.db.query("update public.sprints set end_date='2099-12-31' where id=$1", [sprint]);

  await f.db.query("delete from public.task_links where task_id=$1", [child]);
  expect(await (await read()).json()).toMatchObject({ basis: { evidence: { status: "absent", links: [] }, decision: { status: "blocked", reason: "evidenceRequired" } } });
  await f.db.query("update public.tasks set review_evidence_exception_note='Independent review evidence documented',review_evidence_exception_confirmed_at=now() where id=$1", [target]);
  expect(await (await read()).json()).toMatchObject({ basis: { evidence: { status: "absent", hasException: true, exceptionNote: "Independent review evidence documented" }, decision: { status: "allowed" } } });
  await f.db.query("update public.sprints set score_locked=true where id=$1", [sprint]);
  expect(await (await read()).json()).toMatchObject({ basis: { sprintLock: { locked: true }, decision: { status: "blocked", reason: "sprintLocked" } } });
}));

test("the displayed Review basis cannot finalize after concurrent evidence, Sprint-lock or actor changes", () => withPlanningCredentialDatabase(async f => {
  const { target, child, sprint, read, decide } = await seed(f);
  const original = (await (await read()).json()).basis;
  const foreign = await decide("deputy", original);
  expect(foreign.status).toBe(409);
  expect(await foreign.json()).toMatchObject({ code: "stale_review_basis" });

  const oldFetch = globalThis.fetch;
  let mutateEvidence = true;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (mutateEvidence && new URL(request.url).pathname.endsWith("/" + commandRpc)) {
      mutateEvidence = false;
      await f.db.query("delete from public.task_links where task_id=$1", [child]);
    }
    return oldFetch(request);
  });
  const changed = await decide("founder", original);
  expect(changed.status).toBe(409);
  expect(await changed.json()).toMatchObject({ code: "stale_review_basis" });
  expect(mutateEvidence).toBe(false);
  expect((await f.db.query("select count(*)::int as reviews from public.task_reviews where task_id=$1", [target])).rows[0].reviews).toBe(0);
  await f.db.query("update public.tasks set review_evidence_exception_note='Valid exception',review_evidence_exception_confirmed_at=now() where id=$1", [target]);

  const beforeLock = (await (await read()).json()).basis;
  await f.db.query("update public.sprints set score_locked=true where id=$1", [sprint]);
  const locked = await decide("founder", beforeLock);
  expect(locked.status).toBe(409);
  expect(await locked.json()).toMatchObject({ code: "stale_review_basis" });
  await f.db.query("update public.sprints set score_locked=false where id=$1", [sprint]);
  const owned = (await (await read()).json()).basis;
  await f.db.query("update public.tasks set review_owner_profile_id=$2 where id=$1", [target, f.actors.other.profileId]);
  expect((await read()).status).toBe(403);
  const moved = await decide("founder", owned);
  expect(moved.status).toBe(403);
  expect(await moved.json()).toMatchObject({ code: "forbidden" });
  expect((await f.db.query("select count(*)::int as reviews from public.task_reviews where task_id=$1", [target])).rows[0].reviews).toBe(0);
}));

test("Review honors temporal expiry, applies one confirmed decision, and rejects a later stale write", () => withPlanningCredentialDatabase(async f => {
  const { target, sprint, read, decide } = await seed(f);
  await f.db.query("update public.sprints set review_due_at=now()+interval '1 minute' where id=$1", [sprint]);
  const old = (await (await read()).json()).basis;
  expect(Date.parse(old.validUntil)).toBeLessThan(old.readAuthority.deadline);
  const future = vi.spyOn(Date, "now").mockReturnValue(Date.parse(old.validUntil) + 1);
  try {
    const expired = await decide("founder", old);
    expect(expired.status).toBe(409);
    expect(await expired.json()).toMatchObject({ code: "stale_review_basis" });
  } finally { future.mockRestore(); }
  expect((await f.db.query("select count(*)::int as reviews from public.task_reviews where task_id=$1", [target])).rows[0].reviews).toBe(0);

  const ready = (await (await read()).json()).basis;
  const result = await decide("founder", ready);
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ ok: true, review: { taskId: target, decision: "changes_requested" }, task: { id: target } });
  const conflicting = await decide("founder", ready);
  expect(conflicting.status).toBe(409);
  expect(await conflicting.json()).toMatchObject({ conflictReason: "revision" });
  expect((await f.db.query("select count(*)::int as reviews from public.task_reviews where task_id=$1", [target])).rows[0].reviews).toBe(1);
}));
