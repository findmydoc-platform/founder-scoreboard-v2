import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { planningRouteProtocol } from "../../helpers/planning-route-protocol.mjs";
const {POST,GET}=await importTestModule("src/app/api/sprints/[id]/lock/route.ts",{"server-only":{}});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const sprint={id:"lock",project_id:"findmydoc-founder-execution",name:"Sprint 1",status:"review",start_date:"2020-01-01",end_date:"2020-01-14",review_due_at:"2020-01-16T22:59:59Z",score_locked:false,updated_at:"2020-01-17T08:30:00Z",lock_result:null};
const receipt={sprint:{id:"lock",status:"closed",scoreLocked:true},carryover:{created:0,evaluated:0},scoring:{scores:0,strikeEvents:0}};
const payload={expectedUpdatedAt:"2020-01-17T08:30:00Z",expectedTasks:[]}, context={params:Promise.resolve({id:"lock"})};
function protocol(options = {}) {
  const tables = options.tables || {};
  const tasks = Array.isArray(tables.active_tasks) ? tables.active_tasks.map(task => ({ ...task, sprint_id: "lock", project_id: sprint.project_id })) : [];
  const supplied = { sprints: (request, url) => url.searchParams.get("id") === "eq.lock" ? sprint : null, active_tasks: [], ...tables };
  return planningRouteProtocol({
    role:"ceo", ...options,
    responses: {
      planning_sprint_completion_snapshot: () => Response.json({
        status:"ready", source_revision:"49", evaluated_at:new Date(Date.now()-100).toISOString(),
        valid_until:new Date(Date.now()+30_000).toISOString(), review_due_at:sprint.review_due_at,
        open_objections:0, next_sprint_id:null, sprint, tasks, accepted_adjustments:[], blocker_task_ids:[],
        profiles:[{ id:"synthetic-profile", name:"Synthetic CEO", platform_role:"ceo", weekly_capacity:0 }],
        commitments:[], meetings:[], attendance:[], strike_states:[],
        ...options.snapshotFields,
      }),
      planning_sprint_completion_publication_context: { status:"ready", profile_id:"synthetic-profile", platform_role:"ceo", source_revision:"49" },
      commit_sprint_completion_basis: body => {
        expect(body.p_expected_updated_at).toBe(payload.expectedUpdatedAt);
        expect(body.p_result_data._planning_lock_basis).toEqual([]);
        expect(body.p_source_revision).toBe("49");
        return Response.json(receipt);
      },
      ...options.responses,
    },
    tables:Object.fromEntries(Object.entries(supplied).map(([key,value]) => [
      key, Array.isArray(value) ? () => Response.json(value,{headers:{"content-range":value.length ? `0-${value.length-1}/${value.length}` : "*/0"}}) : value,
    ])),
  });
}
test("lock uses the original displayed Sprint/task basis and returns only the actual atomic receipt",async()=>{const p=protocol();const response=await POST(p.request("/api/sprints/lock/lock","POST",payload),context);const body=await response.json();expect(response.status,JSON.stringify(body)).toBe(200);expect(body).toMatchObject(receipt);});
test("a lock receipt check is an authorized GET and performs no lock or planning mutation",async()=>{const p=protocol({tables:{sprints:{...sprint,status:"closed",score_locked:true,lock_result:receipt}}});const response=await GET(p.request("/api/sprints/lock/lock"),context);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({receipt,basis:{sprint:{id:"lock",updatedAt:"2020-01-17T08:30:00Z"}}});expect(p.calls.some(call=>call.name === "commit_sprint_completion_basis"||call.name.includes("sprint_plan"))).toBe(false);});
test.each(["founder","deputy","administrator"])("the existing lock action policy rejects an unauthorized %s on GET and POST",async role=>{const p=protocol({role,snapshot:{eligible:role==="administrator",active:false,expiresAt:null}});expect((await GET(p.request("/api/sprints/lock/lock"),context)).status).toBe(403);expect((await POST(p.request("/api/sprints/lock/lock","POST",payload),context)).status).toBe(403);});
test.each([{}, {expectedUpdatedAt:"2020-01-17T08:30:00Z"}])("missing original lock basis fails before mutation: %j",async body=>{const p=protocol();expect((await POST(p.request("/api/sprints/lock/lock","POST",body),context)).status).toBe(400);expect(p.calls.some(call=>call.name === "commit_sprint_completion_basis")).toBe(false);});
test.each([["P0001","sprint_lock_conflict"],["P0007","sprint_lock_tasks_conflict"],["P0004","sprint_lock_objections"],["P0006","sprint_lock_window"]])("lock rejection %s retains its domain classification",async(code,result)=>{const p=protocol({responses:{commit_sprint_completion_basis:()=>Response.json({code,message:"rejected"},{status:400})}});const response=await POST(p.request("/api/sprints/lock/lock","POST",payload),context);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:result});});
test("a partial active-task read cannot be treated as a complete lock basis",async()=>{const p=protocol({snapshotFields:{attendance:undefined}});const response=await POST(p.request("/api/sprints/lock/lock","POST",payload),context);expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"sprint_lock_incomplete"});expect(p.calls.some(call=>call.name === "commit_sprint_completion_basis")).toBe(false);});

test("an active administrator retains the existing governance CEO denial on both lock endpoints",async()=>{const p=protocol({role:"administrator",snapshot:{eligible:true,active:true,expiresAt:new Date(Date.now()+60000).toISOString()}});expect((await GET(p.request("/api/sprints/lock/lock"),context)).status).toBe(403);expect((await POST(p.request("/api/sprints/lock/lock","POST",payload),context)).status).toBe(403);});

test("a task edited since the displayed gesture is rejected before lock mutation",async()=>{const p=protocol({tables:{active_tasks:[{id:"changed",updated_at:"2020-01-17T09:00:00Z"}]}});const response=await POST(p.request("/api/sprints/lock/lock","POST",{...payload,expectedTasks:[{id:"changed",updatedAt:"2020-01-17T08:30:00Z"}]}),context);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:"sprint_lock_tasks_conflict"});expect(p.calls.some(call=>call.name === "commit_sprint_completion_basis")).toBe(false);});
test("anonymous access cannot inspect a stored lock receipt or execute a lock",async()=>{const p=protocol({authError:401});expect((await GET(p.request("/api/sprints/lock/lock"),context)).status).toBe(401);expect((await POST(p.request("/api/sprints/lock/lock","POST",payload),context)).status).toBe(401);});


test("older schema still supports Recovery while a new completion fails closed", async () => {
  const p = protocol({ responses: {
    planning_sprint_completion_snapshot: () => Response.json({ code:"PGRST202", message:"Missing function" }, { status:404 }),
  } });
  const previous = await GET(p.request("/api/sprints/lock/lock"),context);
  expect(previous.status).toBe(200);
  expect((await previous.json()).tasksComplete).toBe(true);
  const blocked = await POST(p.request("/api/sprints/lock/lock","POST",payload),context);
  expect(blocked.status).toBe(503);
  expect(await blocked.json()).toMatchObject({ code:"sprint_lock_incomplete" });
  expect(p.calls.some(call=>call.name==="commit_sprint_completion_basis")).toBe(false);
});

test("the same atomic source rejection signals a targeted refresh to both client versions", async () => {
  const p = protocol({ responses: {
    commit_sprint_completion_basis: () => Response.json({ code:"P0021", message:"Source changed" }, { status:400 }),
  } });
  const prepared = await GET(p.request("/api/sprints/lock/lock?area=completion"),context);
  expect(prepared.status).toBe(200);
  const { decision } = await prepared.json();
  expect(decision.status).toBe("ready");
  const current = await POST(p.request("/api/sprints/lock/lock","POST",{ ...payload, completionBasis:decision.token }),context);
  const legacy = await POST(p.request("/api/sprints/lock/lock","POST",payload),context);
  expect(current.status).toBe(409);
  expect(legacy.status).toBe(409);
  expect(await current.json()).toMatchObject({ code:"sprint_lock_basis_stale" });
  expect(await legacy.json()).toMatchObject({ code:"sprint_lock_conflict" });
});
