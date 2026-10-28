import { expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { importTestModule } from "../../helpers/vitest-module.mjs";
const { createSupabaseTeamReadModel } = await importTestModule("src/features/team/server/team-read-model-supabase.ts", { "server-only": {} });

const { createSupabaseProfileReadModel } = await importTestModule("src/features/profile/server/profile-read-model-supabase.ts", { "server-only": {} });

const { createSupabaseEventsReadModel } = await importTestModule("src/features/events/server/events-read-model-supabase.ts", { "server-only": {} });
const { createSupabaseToolsReadModel } = await importTestModule("src/features/tools/server/tools-read-model-supabase.ts", { "server-only": {} });

const { createSupabaseNotificationsReadModel } = await importTestModule("src/features/notifications/server/notifications-read-model-supabase.ts", { "server-only": {} });

function postgrest(tables = {}) {
 const calls=[];
 const fetch=async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url),table=url.pathname.split("/").at(-1);
  const configured=tables[table]||{rows:[]};
  calls.push({table,method:request.method,count:request.headers.get("prefer"),limit:url.searchParams.get("limit")});
  if(configured.error)return Response.json({code:"XX000",message:"Unavailable"},{status:503});
  const rows=(configured.rows||[]).slice(0,Math.min(1000,Number(url.searchParams.get("limit"))||1000));
  const exact=request.headers.get("prefer")?.includes("count=exact");
  const total=configured.count===undefined?(configured.rows||[]).length:configured.count;
  const headers=exact&&total!==null?{"content-range":rows.length?`0-${rows.length-1}/${total}`:`*/${total}`} : {};
  const data=request.headers.get("accept")?.includes("vnd.pgrst.object")?(rows[0]||null):rows;
  return Response.json(data,{headers});
 };
 return {client:createClient("http://localhost:3000","synthetic-key",{global:{fetch},db:{retry:false},auth:{persistSession:false,autoRefreshToken:false}}),calls};
}
const profile=id=>({id,name:`Person ${id}`,platform_role:"founder",weekly_capacity:20});
const task=id=>({id,project_id:"findmydoc-founder-execution",title:`Task ${id}`,task_type:"initiative",status:"Offen",updated_at:"opaque/task"});
const collectionRows={profiles:profile,active_tasks:task,planning_item_strategy:id=>({task_id:`task-${id}`,goal:"Goal"}),planning_item_raci_assignments:id=>({task_id:`task-${id}`,profile_id:"person",role:"accountable",sort_order:0}),task_links:id=>({id,task_id:`task-${id}`,type:"evidence",label:"Evidence",url:"https://example.test/evidence",position:0,metadata:{}})};
const coverageKeys={profiles:"people",active_tasks:"items",planning_item_strategy:"strategies",planning_item_raci_assignments:"raci",task_links:"links"};

test.each(Object.keys(collectionRows))("Team reports a truncated %s scope independently through actual PostgREST count metadata",async table=>{
 const db=postgrest({[table]:{rows:Array.from({length:1000},(_,id)=>collectionRows[table](id)),count:1001}});
 const result=await createSupabaseTeamReadModel(db.client).load({authorized:true,actorProfileId:null});
 expect(result.status).toBe("ready");expect(result.model.readCoverage).toEqual({...Object.fromEntries(Object.values(coverageKeys).map(key=>[key,"complete"])),[coverageKeys[table]]:"partial"});
 expect(db.calls).toHaveLength(5);expect(db.calls.every(call=>call.method==="GET")).toBe(true);
 expect(db.calls.find(call=>call.table===table).count).toContain("count=exact");
});

test("Team preserves authoritative empty scopes while missing counts remain partial",async()=>{
 const known=await createSupabaseTeamReadModel(postgrest().client).load({authorized:true,actorProfileId:null});
 expect(known.status).toBe("ready");expect(known.model.readCoverage).toEqual({people:"complete",items:"complete",strategies:"complete",raci:"complete",links:"complete"});expect(known.model.people).toEqual([]);expect(known.model.items).toEqual([]);
 const db=postgrest({profiles:{rows:[profile("visible")],count:null},active_tasks:{rows:[],count:null}});
 const partial=await createSupabaseTeamReadModel(db.client).load({authorized:true,actorProfileId:null});expect(partial.model.readCoverage).toMatchObject({people:"partial",items:"partial"});expect(partial.model.people[0].id).toBe("visible");
});


test("Profile separately reports truncated initiative membership and preferences without losing complete empty auxiliary scopes",async()=>{
 const db=postgrest({projects:{rows:[{id:"findmydoc-founder-execution",name:"Project",range_label:null,review_objection_window_hours:48}]},profiles:{rows:[profile("person")]},active_tasks:{rows:[task("initiative")],count:1001},notification_preferences:{rows:[],count:1},profile_ui_preferences:{rows:[{profile_id:"person",updated_at:"opaque/preference"}],count:1001}});
 const result=await createSupabaseProfileReadModel(db.client).load({authorized:true,actorProfileId:"person"});
 expect(result.status).toBe("ready");expect(result.model.readCoverage).toEqual({project:"complete",people:"complete",initiatives:"partial",strategies:"complete",raci:"complete",links:"complete",notificationPreferences:"partial",preferences:"partial"});expect(result.model.initiatives.map(row=>row.id)).toEqual(["initiative"]);expect(result.model.preferences[0].profileId).toBe("person");
 expect(db.calls).toHaveLength(8);expect(db.calls.find(call=>call.table==="notification_preferences").count).toContain("count=exact");expect(db.calls.find(call=>call.table==="profile_ui_preferences").count).toContain("count=exact");
});

test.each([[0,"complete"],[null,"partial"]])("Profile distinguishes exact empty preference counts from unknown counts: %s",async(count,coverage)=>{
 const db=postgrest({projects:{rows:[{id:"findmydoc-founder-execution",name:"Project"}]},notification_preferences:{rows:[],count},profile_ui_preferences:{rows:[],count}});const result=await createSupabaseProfileReadModel(db.client).load({authorized:true,actorProfileId:null});expect(result.status).toBe("ready");expect(result.model.readCoverage.notificationPreferences).toBe(coverage);expect(result.model.readCoverage.preferences).toBe(coverage);
});


for(const [name,factory] of [["Events",createSupabaseEventsReadModel],["Tools",createSupabaseToolsReadModel]]) {
 test.each([[1000,1001,"partial"],[0,0,"complete"],[1,null,"partial"],[1000,1000,"complete"]])(`${name} retains independent people completeness at %s/%s`,async(returned,count,coverage)=>{
  const db=postgrest({profiles:{rows:Array.from({length:returned},(_,id)=>profile(String(id))),count}});
  const result=await factory(db.client).load({authorized:true,actorProfileId:null});expect(result.status).toBe("ready");expect(result.model.people).toHaveLength(returned);expect(result.model.readCoverage).toEqual({people:coverage});
  expect(result.model.coverage).toEqual(name==="Events"?{range:null,completeness:"complete"}:"complete");expect(db.calls).toHaveLength(2);expect(db.calls.find(call=>call.table==="profiles").count).toContain("count=exact");
 });
}


test("Notifications carries independently counted common scopes without treating forbidden delivery rows as complete empty",async()=>{
 const db=postgrest({profiles:{rows:[profile("founder")],count:1001},active_tasks:{rows:[task("visible")],count:1001},task_links:{rows:[],count:1},notification_deliveries:{rows:[{id:1,event_id:1,channel:"google_chat",status:"queued",attempts:0,payload:{}}]}});
 const result=await createSupabaseNotificationsReadModel(db.client).load({authorized:true,actorProfileId:"founder"});expect(result.status).toBe("ready");expect(result.model.readCoverage).toEqual({people:"partial",items:"partial",strategies:"complete",raci:"complete",links:"partial"});expect(result.model.coverage).toEqual({events:"complete",deliveries:"forbidden"});expect(result.model.deliveries).toEqual([]);expect(result.model.items.map(row=>row.id)).toEqual(["visible"]);expect(db.calls).toHaveLength(7);
});

test.each([[0,0,"complete","complete"],[499,99,"complete","complete"],[500,100,"partial","partial"]])("lead Notifications preserves its explicit event/delivery query caps: %s/%s",async(events,deliveries,eventCoverage,deliveryCoverage)=>{
 const db=postgrest({profiles:{rows:[{...profile("ceo"),platform_role:"ceo"}]},notification_events:{rows:Array.from({length:events},(_,id)=>({id,type:"task_assigned",actor_profile_id:"ceo",recipient_profile_id:"ceo",title:"Event",body:"Body",status:"unseen",created_at:"2026-10-28T12:00:00Z"}))},notification_deliveries:{rows:Array.from({length:deliveries},(_,id)=>({id,event_id:id,channel:"google_chat",status:"queued",attempts:0,payload:{}}))}});
 const result=await createSupabaseNotificationsReadModel(db.client).load({authorized:true,actorProfileId:"ceo"});expect(result.status).toBe("ready");expect(result.model.coverage).toEqual({events:eventCoverage,deliveries:deliveryCoverage});expect(result.model.readCoverage).toEqual({people:"complete",items:"complete",strategies:"complete",raci:"complete",links:"complete"});expect(result.model.events).toHaveLength(events);expect(result.model.deliveries).toHaveLength(deliveries);expect(db.calls.find(call=>call.table==="notification_events").limit).toBe("500");expect(db.calls.find(call=>call.table==="notification_deliveries").limit).toBe("100");
});


for(const [name,factory,failed] of [["Team",createSupabaseTeamReadModel,"planning_item_strategy"],["Profile",createSupabaseProfileReadModel,"profile_ui_preferences"],["Events",createSupabaseEventsReadModel,"profiles"],["Tools",createSupabaseToolsReadModel,"profiles"],["Notifications",createSupabaseNotificationsReadModel,"active_tasks"]]) {
 test(`${name} retains denied-without-dispatch and unavailable-without-fabricated-coverage behavior`,async()=>{
  const denied=postgrest();expect(await factory(denied.client).load({authorized:false,actorProfileId:null})).toEqual({status:"forbidden"});expect(denied.calls).toEqual([]);
  const db=postgrest({projects:{rows:[{id:"findmydoc-founder-execution",name:"Project"}]},[failed]:{error:true}});expect(await factory(db.client).load({authorized:true,actorProfileId:null})).toEqual({status:"unavailable"});
 });
}
