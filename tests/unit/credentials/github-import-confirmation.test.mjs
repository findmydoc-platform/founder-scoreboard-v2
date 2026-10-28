import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
const revision = "2026-10-28T00:00:00.000Z";
for (const previous of [null, "", "  "]) for (const stale of [false, true]) test(`Evidence import compares raw nullable Evidence and actual Task revision (previous=${JSON.stringify(previous)}, stale=${stale})`, async () => {
 const protocol = administratorProtocol({role:"founder",snapshot:{eligible:false,active:false,expiresAt:null}}), authFetch=globalThis.fetch;
 let writes=0, currentEvidence=previous;
 vi.stubGlobal("fetch", async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url);
  if(url.pathname==="/rest/v1/tasks") {
   if(request.method==="GET") { assert.ok(url.searchParams.get("select").includes("updated_at"));return Response.json({id:"task",title:"Task",task_type:"deliverable",status:"In Arbeit",assignee:"synthetic-profile",owner:"synthetic-profile",evidence_link:previous,updated_at:revision}); }
   writes++; if(stale) currentEvidence="https://manual.example.test/newer";
   assert.equal(url.searchParams.get("updated_at"),`eq.${revision}`);assert.equal(url.searchParams.get("evidence_link"),previous===null?"is.null":`eq.${previous}`);
   const patch=await request.json();assert.equal(patch.github_issue_sync_status,"not_synced");assert.equal(patch.updated_at,undefined);
   if(currentEvidence!==previous)return Response.json(null);
   currentEvidence=patch.evidence_link;return Response.json({id:"task"});
  }
  return authFetch(request);
 });
 const {requirePlanningContext}=await importTestModule("src/features/planning/server/planning-api-context.ts",{"server-only":{}});
 const context=await requirePlanningContext(protocol.request(),"planning.github-comments.import","task");assert.equal(context.ok,true);
 const result=await context.planning.updateImportedEvidence("https://imported.example.test/evidence");assert.equal(writes,1);
 if(stale){assert.equal(result.error.code,"import_evidence_stale");assert.equal(currentEvidence,"https://manual.example.test/newer");}else{assert.equal(result.error,null);assert.equal(currentEvidence,"https://imported.example.test/evidence");}
});
test("fixed imported-comment read requests exact count and Task plus GitHub coverage",async()=>{
 const protocol=administratorProtocol({snapshot:{eligible:false,active:false,expiresAt:null}}),authFetch=globalThis.fetch;let reads=0;
 vi.stubGlobal("fetch",async(input,init)=>{const request=new Request(input,init),url=new URL(request.url);if(url.pathname==="/rest/v1/task_external_comments"){reads++;assert.equal(url.searchParams.get("task_id"),"eq.task");assert.equal(url.searchParams.get("source"),"eq.github");assert.ok(request.headers.get("prefer").includes("count=exact"));return Response.json([],{headers:{"content-range":"*/1001"}});}return authFetch(request);});
 const {requirePlanningContext}=await importTestModule("src/features/planning/server/planning-api-context.ts",{"server-only":{}});const context=await requirePlanningContext(protocol.request(),"planning.github-comments.import","task");assert.equal(context.ok,true);const result=await context.planning.readImportedComments();assert.equal(result.count,1001);assert.equal(reads,1);
});
for (const mode of ["unmapped","foreign-assignee","revoked"]) test(`Evidence import preserves ${mode} credential and field permission boundary`,async()=>{
 const protocol=administratorProtocol({profile:mode!=="unmapped",role:"founder",snapshot:{eligible:false,active:false,expiresAt:null}}),authFetch=globalThis.fetch;let writes=0;
 vi.stubGlobal("fetch",async(input,init)=>{const request=new Request(input,init),url=new URL(request.url);if(url.pathname==="/rest/v1/tasks"){if(request.method!=="GET"){writes++;return Response.json({id:"task"});}return Response.json({id:"task",task_type:"deliverable",status:"In Arbeit",assignee:mode==="foreign-assignee"?"other":"synthetic-profile",owner:"other",evidence_link:null,updated_at:revision});}return authFetch(request);});
 const {requirePlanningContext}=await importTestModule("src/features/planning/server/planning-api-context.ts",{"server-only":{}});const context=await requirePlanningContext(protocol.request(),"planning.github-comments.import","task");
 if(context.ok){if(mode==="revoked")protocol.state.profile=false;const result=await context.planning.updateImportedEvidence("https://evidence.example.test");assert.ok(result.error);}else assert.equal(mode,"unmapped");assert.equal(writes,0);
});
