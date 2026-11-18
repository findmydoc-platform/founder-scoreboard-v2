import { expect, test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
const { loadPlanningBacklogSelection } = await importTestModule("src/features/planning-items/server/planning-backlog-read-source.ts", { "server-only": {} });
const { taskRowColumns } = await importTestModule("src/lib/planning-row-types.ts");
const { DEFAULT_BACKLOG_FILTERS } = await importTestModule("src/features/backlog/model/backlog-view-model.ts");
function fixture() {
  const deadline=Date.now()+60_000;
  const item={...Object.fromEntries(taskRowColumns.map(key=>[key,null])),id:"bounded-item",task_type:"deliverable",title:"Bounded Item",status:"Offen",owner:"bounded-person",assignee:"bounded-person",created_by:"bounded-person",sprint_id:"bounded-sprint",updated_at:"2026-11-01T12:00:00Z",task_dependencies:[{note:"Existing dependency"}],task_notes:{note:"Omitted private note"}};
  const person={id:"bounded-person",name:"Known person",platform_role:"founder",org_role:"Founder",github_login:"",deputy_for:null,deputy_active_from:null,deputy_active_until:null,focus:null,weekly_capacity:40,profile_color:null};
  const sprint={id:"bounded-sprint",name:"Known Sprint",status:"planning",start_date:"2026-11-16",end_date:"2026-11-29",review_due_at:null,score_locked:false,updated_at:"2026-11-01T12:00:00Z"};
  const data={status:"ready",source_revision:"atomic-source",observed_at:new Date().toISOString(),valid_until:new Date(deadline).toISOString(),item_ids:[item.id],context_ids:[],rank_by_id:{[item.id]:1},parent_progress_by_id:{},total:1,hydrated_items:[item],hydrated_people:[person],hydrated_sprints:[sprint]};
  const calls=[];
  const database={rpc(name){calls.push(name);return Promise.resolve({data,error:null});},from(){throw Error("No separate data dispatch or compatibility fallback");}};
  const context={authorized:true,actorProfileId:person.id,authorityDeadline:deadline,authorityKey:"synthetic-atomic-continuation-key",publicationSource:{read:async()=>({status:"ready",revision:data.source_revision})}};
  const query={view:"backlog",filters:{...DEFAULT_BACKLOG_FILTERS},limit:20};
  return{data,database,context,query,calls};
}
test("atomic selected hydration preserves current bounded fields and existing omissions without data dispatches",async()=>{
  const f=fixture(),result=await loadPlanningBacklogSelection(f.database,f.context,f.query);
  expect(result.status).toBe("ready");expect(f.calls).toEqual(["planning_backlog_selection"]);
  expect(result.model.items).toHaveLength(1);expect(result.model.items[0]).toMatchObject({id:"bounded-item",title:"Bounded Item",assignee:"Known person",createdBy:"Known person",sprintId:"bounded-sprint",dependsOn:"Existing dependency",detailAvailability:"summary"});
  expect(result.model.items[0]).not.toHaveProperty("note");expect(result.model.items[0]).not.toHaveProperty("description");
  expect(result.model.people.map(row=>row.id)).toEqual(["bounded-person"]);expect(result.model.sprints.map(row=>row.id)).toEqual(["bounded-sprint"]);
  expect(result.authorityDeadline).toBe(f.context.authorityDeadline);
});
test("atomic selected hydration rejects missing fields and extra identities without a wider fallback",async()=>{
  for(const mutate of [
    data=>{delete data.hydrated_items[0].updated_at;},
    data=>{data.hydrated_items.push({...data.hydrated_items[0],id:"unselected-item"});},
    data=>{data.hydrated_people.push({...data.hydrated_people[0],id:"unreferenced-person"});},
    data=>{data.hydrated_sprints.push({...data.hydrated_sprints[0],id:"unreferenced-sprint"});},
  ]){const f=fixture();mutate(f.data);expect(await loadPlanningBacklogSelection(f.database,f.context,f.query)).toEqual({status:"unavailable"});expect(f.calls).toEqual(["planning_backlog_selection"]);}
});
