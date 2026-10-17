import {vi} from "vitest";
import {importTestModule} from "./vitest-module.mjs";

export const cronSecret="synthetic-cron-secret";
export function cronWebhookProtocol() {
 const origin="https://cron-storage.example.test";
 for(const [name,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:origin,SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_ANON_KEY:"synthetic-anon",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"synthetic-anon",SUPABASE_ANON_KEY:"synthetic-anon",SUPABASE_PUBLISHABLE_KEY:"synthetic-anon",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",SUPABASE_SECRET_KEY:"synthetic-service",CRON_SECRET:cronSecret,FOUNDEROPS_MAINTENANCE_SECRET:"synthetic-maintenance-secret",FOUNDEROPS_DELIVERY_SECRET:"synthetic-delivery-secret",FOUNDEROPS_PLATFORM_RELEASE_TOKEN:"synthetic-release-secret",GITHUB_APP_ID:"",GITHUB_APP_INSTALLATION_ID:"",GITHUB_APP_PRIVATE_KEY:"",GITHUB_APP_PRIVATE_KEY_PATH:""}))vi.stubEnv(name,value);
 const state={calls:[],beforeProjectionClaim:null,commentClaim:null,afterCommentClaim:null,afterApply:null,applied:[],finalized:[],commentAction:"deleted",beforeToken:null,providerRequests:[],tokenRequests:0,queueIds:["synthetic-comment-ready"],afterResolveTask:null,planningQueue:[],planningClaim:false,afterPlanningClaim:null,projectionRows:[],afterTaskRead:null,healthRows:{planning:[],comments:[],projection:[]},projectionFinalizeError:false,queryFailure:null,invalidCount:false,commentStaleQueue:[],planningStaleQueue:[],commentClaimId:null,finalizeDenied:false,liveClaims:new Map(),ownerReads:[],beforeOwnerResponse:null,fullProjection:false,rotateAfterProjectionBegin:false,rotateAfterProjectionProvider:false,projectionProviderConfirmed:false,afterProjectionProvider:null};
 vi.stubGlobal("fetch",async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url);
  if(url.origin==="https://api.github.com"){
   if(url.pathname==="/app/installations/42/access_tokens"){state.tokenRequests++;if(state.beforeToken)await state.beforeToken();return Response.json({token:"synthetic-installation-token",expires_at:new Date(Date.now()+3600000).toISOString()});}
   if(url.pathname==="/repos/findmydoc-platform/management/issues/comments/404"){state.providerRequests.push(url.pathname);return Response.json({id:404,body:"Synthetic mirror <!-- fmd-comment-id:7 -->",html_url:"https://github.com/findmydoc-platform/management/issues/17#issuecomment-404",issue_url:"https://api.github.com/repos/findmydoc-platform/management/issues/17",created_at:"2026-10-17T10:00:00Z",updated_at:"2026-10-17T10:00:00Z",user:{login:"synthetic-founder"}});}
   if(state.fullProjection){
    state.providerRequests.push({method:request.method,path:url.pathname});
    if(url.pathname==="/graphql"){
     const body=await request.json();if(body.query.includes("closedByPullRequestsReferences")){state.projectionProviderConfirmed=true;if(state.rotateAfterProjectionProvider)vi.stubEnv("CRON_SECRET","replacement-after-confirmed-provider");if(state.afterProjectionProvider)await state.afterProjectionProvider();}
     return Response.json({data:{organization:{projectV2:{id:"project-1",closed:false,fields:{nodes:[]}},issueFields:{nodes:[]}},repository:{issue:{id:"issue-7",projectItems:{nodes:[{id:"item-7",isArchived:false,project:{id:"project-1"}}]},closedByPullRequestsReferences:{nodes:[]}}},node:{id:"item-7",project:{id:"project-1"},content:{id:"issue-7",issueFieldValues:{nodes:[]}},fieldValues:{nodes:[]}}}});
    }
    if(request.method==="GET"&&url.pathname.endsWith("/issues/7"))return Response.json({number:7,html_url:"https://github.com/findmydoc-platform/management/issues/7",title:"Synthetic projection",body:"<!-- founderops-task-id:projection-task -->",labels:[]});
    if(url.pathname.includes("/dependencies/"))return Response.json([]);
    if(request.method==="PATCH")return Response.json({number:7,html_url:"https://github.com/findmydoc-platform/management/issues/7"});
   }
   throw new Error("Unexpected GitHub provider protocol in Cron test");
  }
  if(url.origin!==origin)throw new Error("Unexpected external protocol in Cron test");
  const path=url.pathname.split("/").at(-1),body=request.method==="POST"?await request.json():null;state.calls.push({path,body,method:request.method,url});
  if(path==="claim_planning_github_projection_requests"){if(state.beforeProjectionClaim)await state.beforeProjectionClaim();for(const row of state.projectionRows)state.liveClaims.set("planning_github_projection_outbox:"+row.id,{id:row.id,status:"processing",lock_token:body.p_lock_token,locked_at:new Date().toISOString()});return Response.json(state.projectionRows);}
  if(path==="claim_github_planning_webhook_delivery"){if(state.planningClaim)state.liveClaims.set("github_planning_webhook_deliveries:"+body.p_delivery_id,{delivery_id:body.p_delivery_id,status:"processing",lock_token:body.p_lock_token,locked_at:new Date().toISOString()});if(state.afterPlanningClaim)await state.afterPlanningClaim();return Response.json(state.planningClaim?{delivery_id:body.p_delivery_id,event_name:"issues",action:"edited",repository_full_name:"findmydoc-platform/management",issue_id:202,issue_node_id:"I_synthetic",issue_number:17,issue_updated_at:"2026-10-17T10:00:00Z",sender_type:"Bot",attempts:1}:null);}
  if(path==="finalize_github_planning_webhook_delivery"){state.finalized.push(body);return Response.json(true);}
  if(path==="finalize_planning_github_projection_request"){state.finalized.push(body);if(state.projectionFinalizeError)return Response.json({code:"XX000",message:"Sensitive finalization detail"},{status:400});return Response.json({status:"retry_scheduled"});}
  if(state.fullProjection){
   if(path==="try_acquire_github_issue_sync_lock")return Response.json("confirmed-task-lock");
   if(path==="begin_github_issue_sync_transaction_v2"){if(state.rotateAfterProjectionBegin)vi.stubEnv("CRON_SECRET","replacement-after-begin");return Response.json({updated_at:"confirmed-pending-revision"});}
   if(path==="release_github_issue_sync_lock")return Response.json(true);
   if(path==="finalize_github_issue_sync_with_pull_requests_v1")return Response.json({updated_at:"final-revision"});
   if(path==="profiles"||path==="task_relationship_edges")return Response.json([]);
   if(path==="projects")return Response.json({github_project_owner:"findmydoc-platform",github_project_number:1,github_mention_team_slug:null});
   if(path==="claim_task_comment_github_deliveries"||path==="claim_task_review_github_deliveries")return Response.json([]);
   if(path==="active_tasks")return Response.json({id:"projection-task",task_type:"deliverable",title:"Synthetic projection",approval_status:"approved",status:"Offen",priority:"P2",updated_at:"original-revision",github_repo:"findmydoc-platform/management",github_issue_number:7,github_issue_url:"https://github.com/findmydoc-platform/management/issues/7"});
  }
  if(path==="tasks"){if(state.afterTaskRead)await state.afterTaskRead();return Response.json(state.fullProjection?(url.searchParams.has("id")?{id:"projection-task",trashed_at:null}:[]):null);}
  if(path==="claim_github_issue_comment_webhook_delivery"){if(state.commentClaim)state.liveClaims.set("github_webhook_deliveries:"+body.p_delivery_id,{delivery_id:body.p_delivery_id,status:"processing",lock_token:body.p_lock_token,locked_at:new Date().toISOString()});if(state.afterCommentClaim)await state.afterCommentClaim();return Response.json(state.commentClaim?{delivery_id:state.commentClaimId||body.p_delivery_id,action:state.commentAction,repository_full_name:"findmydoc-platform/management",issue_number:17,comment_id:404,comment_updated_at:"2026-10-17T10:00:00Z",attempts:1}:null);}
  if(path==="task_comments")return Response.json({id:7});
  if(path==="resolve_github_issue_comment_webhook_tasks"){if(state.afterResolveTask)await state.afterResolveTask();return Response.json([{task_id:"synthetic-task"}]);}
  if(path==="apply_github_issue_comment_webhook_projection_with_mentions"){state.applied.push(body);if(state.afterApply)await state.afterApply();return Response.json("applied");}
  if(path==="finalize_github_issue_comment_webhook_delivery"){state.finalized.push(body);return Response.json(!state.finalizeDenied);}
  const ownerSelect=url.searchParams.get("select");
  if(ownerSelect?.includes("lock_token")&&["github_planning_webhook_deliveries","github_webhook_deliveries","planning_github_projection_outbox","planning_github_lifecycle_outbox"].includes(path)){
   const id=(url.searchParams.get(path.includes("outbox")?"id":"delivery_id")||"").replace(/^eq\./,"");const row=structuredClone(state.liveClaims.get(path+":"+id)||null);state.ownerReads.push({path,id});if(state.beforeOwnerResponse)await state.beforeOwnerResponse({path,id,row});return Response.json(row);
  }
  const family=path==="github_planning_webhook_deliveries"?"planning":path==="github_webhook_deliveries"?"comments":path==="planning_github_projection_outbox"?"projection":null;
  if(family){
   const select=url.searchParams.get("select");
   if((state.queryFailure==="queue"&&select==="delivery_id,received_at")||(state.queryFailure==="health"&&select==="status_reason")||(state.queryFailure==="count"&&request.method==="HEAD"))return Response.json({code:"XX000",message:"Sensitive queue detail"},{status:400});
   if(select==="delivery_id,received_at"){
    const stale=url.searchParams.get("status")==="eq.processing";const ids=family==="planning"?(stale?state.planningStaleQueue:state.planningQueue):(stale?state.commentStaleQueue:state.queueIds);return Response.json(ids.map(delivery_id=>({delivery_id,received_at:"2026-10-17T10:00:00Z"})));
   }
   const rows=state.healthRows[family].filter(row=>[...url.searchParams].every(([column,filter])=>{
    if(["select","order","limit"].includes(column))return true;
    if(filter.startsWith("eq."))return String(row[column])===filter.slice(3);
    if(filter==="is.null")return row[column]==null;
    if(filter==="not.is.null")return row[column]!=null;
    if(filter.startsWith("in.("))return filter.slice(4,-1).split(",").includes(String(row[column]));
    throw new Error("Unexpected Cron queue filter");
   }));
   if(request.method==="HEAD")return new Response(null,{status:200,headers:{"content-range":`*/${state.invalidCount?"invalid":rows.length}`}});
   return Response.json(rows.map(row=>({[select]:row[select]})));
  }
  throw new Error("Unexpected Cron storage operation");
 });
 return {state,request(headers={authorization:`Bearer ${cronSecret}`}){return new Request("https://app.example.test/api/maintenance/github-webhooks",{headers});},async route(){return importTestModule("src/app/api/maintenance/github-webhooks/route.ts",{"server-only":{}});}};
}
