import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/model/planning-board-query";
import { buildPlanningTaskTableViewModel } from "@/features/planning/model/planning-task-table-view-model";
import { isTaskPlanningActive } from "@/features/planning/model/approval-domain";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { taskRelationsFor } from "@/lib/platform";
import type { Task } from "@/lib/types";

test("selected Gantt supplies every matching approved Deliverable with complete schedule and incident context beyond the provider cap", () => withPlanningCredentialDatabase(async f => {
  const query=`${f.prefix} 50%_Ä Gantt`,sprintId=`${f.prefix}-gantt-sprint`,fallbackSprintId=`${f.prefix}-fallback-sprint`;
  const epicId=`${f.prefix}-epic`,completedEndpoint=`${f.prefix}-completed-endpoint`,openEndpoint=`${f.prefix}-open-endpoint`;
  const id=(n:number)=>`${f.prefix}-gantt-${String(n).padStart(4,"0")}`;
  await f.db.query(`insert into public.sprints(id,project_id,name,status,start_date,end_date)
    values($1,'findmydoc-founder-execution','Selected Gantt Sprint','planning','2026-11-16','2026-11-20'),
      ($2,'findmydoc-founder-execution','Earlier schedule fallback','closed','2026-01-05','2026-01-09')`,[sprintId,fallbackSprintId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,sort_order,approval_status,owner,assignee,sprint_id)
    select $1||'-gantt-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Selected Gantt Item '||n,$2,'deliverable',$3,
      'Offen',case when n=1008 then 'P0' when n in (1006,1007) then 'P1' else 'P2' end,
      case when n in (1006,1007) then 7 else n*2 end,'approved',$4,$4,$5
    from generate_series(1,1008) n`,[f.prefix,query,f.initiativeId,f.actors.founder.profileId,sprintId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,approval_status,owner,assignee)
    values($1,'findmydoc-founder-execution','Completed off-selection blocker','Unmatched endpoint','deliverable',$4,'Erledigt','P2','approved',$5,$5),
      ($2,'findmydoc-founder-execution','Open off-selection dependent','Unmatched endpoint','deliverable',$4,'Offen','P2','approved',$5,$5),
      ($3,'findmydoc-founder-execution','Matching unapproved proposal',$6,'deliverable',$4,'Offen','P2','proposed',$5,$5)`,
    [completedEndpoint,openEndpoint,`${f.prefix}-gantt-proposal`,f.initiativeId,f.actors.founder.profileId,query]);
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,owner,assignee)
    values($1,'findmydoc-founder-execution','Matching Sub-Issue',$2,'sub_issue',$3,'Offen','P2',$4,$4),
      ($5,'findmydoc-founder-execution','Matching Initiative',$2,'initiative',$6,'Offen','P2',$4,$4)`,
    [`${f.prefix}-gantt-child`,query,id(1),f.actors.founder.profileId,`${f.prefix}-gantt-strategic`,epicId]);
  await f.db.query("update public.tasks set status='Erledigt',updated_at='2000-01-01T00:00:00Z' where id=any($1)",[[id(1008),epicId]]);
  await f.db.query(`insert into public.task_relationship_edges(task_id,related_task_id,relation_type,note)
    values($1,$2,'blocked_by','Completed endpoints still produce Gantt markers'),
      ($3,$1,'blocked_by','Incoming Gantt direction'),
      ($2,$3,'relates_to','Unrelated to the selected Gantt membership')`,[id(1),completedEndpoint,openEndpoint]);

  const {createCompletePlanningReference}=await importTestModule("tests/helpers/complete-planning-reference.ts",{"server-only":{}});
  const client=createClient(f.local.API_URL,f.local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const reference=await createCompletePlanningReference(client).load({authorized:true,actorProfileId:f.actors.founder.profileId,query:{view:"complete"}});
  expect(reference.status).toBe("ready");
  if(reference.status!=="ready")throw new Error("Complete Gantt reference unavailable");
  const data=planningWorkspaceModelToPlanningShellState(reference.model);
  // Gantt keeps its priority/manual order even when the remembered Table sort differs.
  const filters={...DEFAULT_PLANNING_FILTERS,query,sort:"title",direction:"desc" as const};
  const previous=buildPlanningTaskTableViewModel({data,filters,currentProfile:data.profiles.find(profile=>profile.id===f.actors.founder.profileId)!,includeAssignedSubIssueParents:false});
  const matching=previous.visibleTasks.filter(task=>task.taskType==="deliverable"&&isTaskPlanningActive(task));
  const expected=[id(1008),id(1006),id(1007),...Array.from({length:1005},(_,index)=>id(index+1))];
  expect(matching.map(task=>task.id)).toEqual(expected);
  expect(matching[0].status).toBe("Erledigt");
  expect(taskRelationsFor(id(1),data.taskRelations).waitsOn).toHaveLength(1);
  expect(taskRelationsFor(id(1),data.taskRelations).blocks).toHaveLength(1);

  const {GET}=await importTestModule("src/app/api/planning-board-data/route.ts",{"server-only":{}});
  const response=await GET(f.request("founder",`/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({view:"gantt",filters}))}`));
  expect(response.status).toBe(200);
  const body=await response.json();
  expect(body.model).toHaveProperty("gantt");
  const gantt=body.model.gantt;
  expect(gantt.itemIds).toEqual(expected);
  expect(gantt.coverage).toEqual({items:"complete",hierarchy:"complete",schedule:"complete",relationships:"complete"});
  expect(gantt.contextIds).toEqual(expect.arrayContaining([f.initiativeId,epicId]));
  expect(body.model.coverage.items).toBe("partial");
  const allowedIds=new Set([...expected,f.initiativeId,epicId,completedEndpoint,openEndpoint]);
  expect(body.model.items.every((task:Task)=>allowedIds.has(task.id))).toBe(true);
  expect(body.model.items.filter((task:Task)=>expected.includes(task.id))).toHaveLength(1008);
  expect(body.model.items.find((task:Task)=>task.id===epicId).status).toBe("Erledigt");
  expect(body.model.sprints.map((sprint:{id:string})=>sprint.id)).toEqual([fallbackSprintId,sprintId]);
  expect(body.model.sprints.find((sprint:{id:string})=>sprint.id===sprintId)).toMatchObject({startDate:"2026-11-16",endDate:"2026-11-20"});
  expect(body.model.relationships).toHaveLength(2);
  expect(taskRelationsFor(id(1),body.model.relationships).waitsOn).toHaveLength(1);
  expect(taskRelationsFor(id(1),body.model.relationships).blocks).toHaveLength(1);
  expect(body.currentProfile).toMatchObject({id:f.actors.founder.profileId,platformRole:"founder"});
  expect(body.readAuthority.userId).toBe(f.actors.founder.userId);
  expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
  expect(gantt.sourceRevision).toEqual(expect.any(String));
  expect(Number.isFinite(Date.parse(gantt.observedAt))).toBe(true);
}),120_000);
