import {afterEach,expect,test,vi} from "vitest";
import {NextRequest} from "next/server";
import {createCipheriv} from "node:crypto";
import {importTestModule} from "../../helpers/vitest-module.mjs";
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();});
test("the real attachment route binds an operation to owner and content and reconciles a lost response",async()=>{
  const origin="https://attachment-auth.example.test",key=Buffer.alloc(32,1);
  const cipher=createCipheriv("aes-256-gcm",key,Buffer.alloc(12,2));
  const encrypted=Buffer.concat([cipher.update("synthetic-user-access","utf8"),cipher.final()]);
  const ciphertext=[Buffer.alloc(12,2),cipher.getAuthTag(),encrypted].map(part=>part.toString("base64url")).join(".");
  for(const [name,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:origin,SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_ANON_KEY:"synthetic-anon",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"synthetic-anon",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",GITHUB_TOKEN_ENCRYPTION_KEY:key.toString("base64"),REQUIRE_SUPABASE_AUTH:"true"})) vi.stubEnv(name,value);
  const files=new Map();let writes=0,audits=0,lost=true;
  const task={id:"task-1",title:"Synthetic task",task_type:"deliverable",assignee:"author-1",owner:"author-1",status:"Offen",review_status:"not_requested",score_final:false,github_repo:"findmydoc-platform/management",github_issue_number:1,trashed_at:null};
  vi.stubGlobal("fetch",async(input,options)=>{
    const request=new Request(input,options),url=new URL(request.url);
    if(url.hostname==="api.github.com") {
      expect(request.headers.get("authorization")).toBe("Bearer synthetic-user-access");
      if(request.method==="GET") return files.has(url.pathname) ? Response.json(files.get(url.pathname)) : Response.json({message:"Not found"},{status:404});
      expect(request.method).toBe("PUT");writes++;
      expect((await request.json()).content).toBe("aGVsbG8=");
      const content={sha:"b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0",download_url:`https://raw.githubusercontent.com/findmydoc-platform/management/main${url.pathname}`,html_url:"https://github.com/findmydoc-platform/management/blob/main/file.txt"};files.set(url.pathname,content);
      if(lost){lost=false;throw new Error("provider applied upload; response lost");}
      return Response.json({content});
    }
    if(url.origin!==origin) throw new Error("Unscripted attachment provider");
    const other=request.headers.get("authorization")==="Bearer synthetic-other";
    if(url.pathname==="/auth/v1/user") return Response.json({id:other ? "user-2":"user-1",aud:"authenticated",identities:[]});
    if(url.pathname.endsWith("/rpc/workspace_access_context")) return Response.json({mode:"legacy",linkingEnforced:false,userId:other?"user-2":"user-1",profileId:other?"author-2":"author-1"});
    if(url.pathname.endsWith("/rpc/current_authenticated_profile")) return Response.json({id:other?"author-2":"author-1",name:other?"Other":"Author",platform_role:"founder"});
    if(url.pathname.endsWith("/rpc/administrator_access_snapshot")) return Response.json({eligible:false,active:false});
    if(url.pathname==="/rest/v1/tasks" || url.pathname==="/rest/v1/active_tasks") return request.method==="PATCH" ? new Response(null,{status:204}):Response.json(task);
    if(url.pathname==="/rest/v1/profiles") return Response.json({github_login:"synthetic-author"});
    if(url.pathname==="/rest/v1/github_app_user_tokens") return Response.json({profile_id:"author-1",github_login:"synthetic-author",connection_id:"connection-1",credential_version:0,encrypted_access_token:ciphertext,access_token_expires_at:new Date(Date.now()+3600000).toISOString(),revoked_at:null});
    if(url.pathname.endsWith("/rpc/use_github_user_connection")) return Response.json(true);
    if(url.pathname==="/rest/v1/audit_log") return Response.json({id:++audits,entity_id:"task-1",action:"task.attachment_uploaded",created_at:new Date().toISOString()});
    throw new Error(`Unexpected attachment protocol ${url.pathname}`);
  });
  const {POST}=await importTestModule("src/app/api/tasks/[id]/attachments/route.ts",{"server-only":{}});
  const firstId="11111111-1111-4111-8111-111111111111",laterId="22222222-2222-4222-8222-222222222222";
  const send=async(operation,bytes="hello",token="synthetic-owner")=>{
    const form=new FormData();form.append("file",new File([bytes],"hello.txt",{type:"text/plain"}));
    return POST(new NextRequest("https://application.example.test/api/tasks/task-1/attachments",{method:"POST",headers:{authorization:`Bearer ${token}`,"idempotency-key":operation},body:form}),{params:Promise.resolve({id:"task-1"})});
  };
  const first=await send(firstId);expect(first.status).toBe(200);const firstBody=await first.json();
  // The browser can lose the entire successful HTTP response and repeat this same operation.
  const repeated=await send(firstId);expect(repeated.status).toBe(200);expect((await repeated.json()).path).toBe(firstBody.path);expect(writes).toBe(1);
  const changed=await send(firstId,"changed");expect(changed.status).toBe(502);expect(writes).toBe(1);
  const otherOwner=await send(firstId,"hello","synthetic-other");expect(otherOwner.status).toBe(403);expect(writes).toBe(1);
  const later=await send(laterId);expect(later.status).toBe(200);expect((await later.json()).path).not.toBe(firstBody.path);expect(writes).toBe(2);
});
