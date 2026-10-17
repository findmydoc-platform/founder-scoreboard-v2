import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {resolve} from "node:path";
import {createCipheriv,createHmac,randomUUID} from "node:crypto";
import pg from "pg";
import {expect,it,vi} from "vitest";
import {importTestModule} from "../helpers/vitest-module.mjs";

async function fixture(run:(f:any)=>Promise<void>) {
  const {stdout}=await promisify(execFile)(resolve("node_modules/.bin/supabase"),["status","-o","json"]);
  const local=JSON.parse(stdout);
  const api=new URL(local.API_URL);
  if(!["localhost","127.0.0.1"].includes(api.hostname)) throw new Error("Disposable local target required");
  const database=new pg.Client(local.DB_URL);await database.connect();
  const id=`github-user-${randomUUID()}`,userId=randomUUID();
  const originalFetch=globalThis.fetch;
  const key=Buffer.alloc(32,9);
  function encrypt(value:string) {
    const iv=Buffer.alloc(12,7),cipher=createCipheriv("aes-256-gcm",key,iv);
    const bytes=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
    return [iv,cipher.getAuthTag(),bytes].map(part=>part.toString("base64url")).join(".");
  }
  let provider=async(_request:Request)=>Response.json({message:"unexpected synthetic provider"},{status:500});
  const f:any={database,local,id,userId,encrypt,setProvider:(fn:any)=>{provider=fn;},requests:[]};
  try {
    await database.query("insert into auth.users(id,email,role,aud,email_confirmed_at) values ($1,$2,'authenticated','authenticated',now())",[userId,`${id}@example.test`]);
    await database.query("insert into public.profiles(id,auth_user_id,name,platform_role,github_login) values ($1,$2,'Synthetic GitHub author','founder','synthetic-author')",[id,userId]);
    await database.query("insert into public.projects(id,name) values ($1,'Synthetic GitHub project')",[id]);
    await database.query("insert into public.tasks(id,project_id,title,status,approval_status,owner,assignee,github_repo,github_issue_number) values ($1,$1,'Synthetic authored task','Geplant','approved',$1,$1,'findmydoc-platform/management',1)",[id]);
    const comment=await database.query("insert into public.task_comments(task_id,profile_id,comment) values ($1,$1,'Synthetic authored comment') returning id",[id]);
    f.commentId=Number(comment.rows[0].id);f.claim=randomUUID();
    await database.query("update public.task_comment_github_deliveries set status='processing',lock_token=$2,locked_at=clock_timestamp() where task_comment_id=$1",[f.commentId,f.claim]);
    await database.query("insert into public.github_app_user_tokens(profile_id,github_login,github_user_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at) values ($1,'synthetic-author',$2,$3,$4,now()+interval '1 hour',now()+interval '2 hours')",[id,Math.floor(Math.random()*100000000)+100000,encrypt("synthetic-old-access"),encrypt("synthetic-refresh")]);
    for(const [name,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:local.API_URL,SUPABASE_URL:local.API_URL,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,GITHUB_TOKEN_ENCRYPTION_KEY:key.toString("base64"),GITHUB_APP_CLIENT_ID:"synthetic-client",GITHUB_APP_CLIENT_SECRET:"synthetic-client-secret"})) vi.stubEnv(name,value as string);
    vi.stubGlobal("fetch",async(input:RequestInfo|URL,options?:RequestInit)=>{
      const request=new Request(input,options),url=new URL(request.url);
      if(url.origin===api.origin) return originalFetch(request);
      if(url.hostname!=="api.github.com" && url.href!=="https://github.com/login/oauth/access_token") throw new Error("Unscripted external provider");
      f.requests.push({url:url.href,method:request.method,authorization:request.headers.get("authorization")});
      return provider(request);
    });
    f.authorize=async()=>{
      const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
      return authorizeCredentialAction({credential:{kind:"github-comment-delivery",commentId:f.commentId,claimToken:f.claim},action:"github.comment.deliver"});
    };
    f.row=async()=>(await database.query("select * from public.github_app_user_tokens where profile_id=$1",[id])).rows[0];
    f.rpc=async(name:string,body:unknown,credential=local.SERVICE_ROLE_KEY)=>{
      const response=await originalFetch(`${local.API_URL}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:credential,authorization:`Bearer ${credential}`,"content-type":"application/json"},body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    };
    f.store=async(access="synthetic-reconnected")=>{
      const row=await f.row();
      return f.rpc("store_github_user_connection",{p_profile_id:id,p_github_login:"synthetic-author",p_github_user_id:row.github_user_id,p_access:encrypt(access),p_refresh:encrypt("synthetic-new-refresh"),p_access_expires:new Date(Date.now()+3600000).toISOString(),p_refresh_expires:new Date(Date.now()+7200000).toISOString(),p_expected_connection:row.connection_id,p_expected_version:row.credential_version});
    };
    vi.resetModules();await run(f);
  } finally {
    vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();
    await database.query("delete from public.tasks where id=$1",[id]);
    await database.query("delete from public.projects where id=$1",[id]);
    await database.query("delete from public.profiles where id=$1",[id]);
    await database.query("delete from auth.users where id=$1",[userId]);
    await database.end();
  }
}

it("authored entry points retain encrypted owner binding, usage, resource identity and disconnect",async()=>fixture(async f=>{
  f.setProvider(async (request:Request)=>{
    expect(request.headers.get("authorization")).toBe("Bearer synthetic-old-access");
    return Response.json({id:77,html_url:"https://github.com/findmydoc-platform/management/issues/1#issuecomment-77"});
  });
  const access=await f.authorize();
  const {createGitHubIssueComment}=await importTestModule("src/lib/github.ts");
  expect(await createGitHubIssueComment(1,"Synthetic",access.github,`fmd-comment-id:${f.commentId}`)).toMatchObject({id:77});
  expect((await f.row()).last_used_at).not.toBeNull();
  expect((await f.row()).encrypted_access_token).not.toContain("synthetic-old-access");
  await expect(createGitHubIssueComment(2,"Wrong issue",access.github,`fmd-comment-id:${f.commentId}`)).rejects.toThrow("nicht freigegeben");
  const row=await f.row();
  expect(await f.rpc("use_github_user_connection",{p_profile_id:f.id,p_connection_id:row.connection_id,p_version:row.credential_version,p_disconnect:true})).toMatchObject({body:true});
  await expect(createGitHubIssueComment(1,"After disconnect",access.github,`fmd-comment-id:${f.commentId}`)).rejects.toThrow("Verbindung fehlt");
}),30000);

it("separate instances cannot rotate the same snapshot or overwrite a newer connection",async()=>fixture(async f=>{
  await f.database.query("update public.github_app_user_tokens set access_token_expires_at=now()-interval '1 second' where profile_id=$1",[f.id]);
  let release!:()=>void,started!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
  let exchanges=0;
  f.setProvider(async()=>{exchanges++;started();await pending;return Response.json({access_token:"synthetic-rotated",refresh_token:"synthetic-rotated-refresh",expires_in:3600,refresh_token_expires_in:7200});});
  const first=f.authorize();await entered;
  const claimed=await f.row();
  vi.resetModules();
  await expect(f.authorize()).rejects.toThrow("gerade erneuert");
  expect(await f.store()).toMatchObject({body:true});
  release();await expect(first).rejects.toThrow("wurde geändert");
  expect(exchanges).toBe(1);
  f.setProvider(async (request:Request)=>{expect(request.headers.get("authorization")).toBe("Bearer synthetic-reconnected");return Response.json([]);});
  const connected=await f.authorize();
  const {listGitHubIssueComments}=await importTestModule("src/lib/github.ts");
  expect(await listGitHubIssueComments(1,connected.github)).toEqual([]);
  expect(await f.rpc("finalize_github_user_refresh",{p_profile_id:f.id,p_connection_id:claimed.connection_id,p_version:claimed.credential_version,p_claim_id:claimed.refresh_claim_id,p_access:f.encrypt("stale"),p_refresh:f.encrypt("stale-refresh"),p_access_expires:null,p_refresh_expires:null})).toMatchObject({body:false});
}),30000);

it("unknown refresh outcomes require reconnect and association changes invalidate old access",async()=>fixture(async f=>{
  await f.database.query("update public.github_app_user_tokens set access_token_expires_at=now()-interval '1 second' where profile_id=$1",[f.id]);
  let exchanges=0;f.setProvider(async()=>{exchanges++;throw new Error("provider consumed token; response lost");});
  await expect(f.authorize()).rejects.toThrow("erneuert werden");
  await f.database.query("update public.github_app_user_tokens set refresh_claim_expires_at=now()-interval '1 second' where profile_id=$1",[f.id]);
  vi.resetModules();await expect(f.authorize()).rejects.toThrow("Verbindung fehlt");
  expect(exchanges).toBe(1);
  expect(await f.store()).toMatchObject({body:true});
  await f.database.query("update public.profiles set github_login='different-account' where id=$1",[f.id]);
  await expect(f.authorize()).rejects.toThrow("Verbindung fehlt");
  expect((await f.row()).revoked_at).not.toBeNull();
}),30000);

it("anonymous and user credentials cannot call any new vault RPC or read ciphertext",async()=>fixture(async f=>{
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned=`${encode({alg:"HS256",typ:"JWT"})}.${encode({sub:f.userId,role:"authenticated",aud:"authenticated",exp:Math.floor(Date.now()/1000)+3600})}`;
  const token=`${unsigned}.${createHmac("sha256",f.local.JWT_SECRET).update(unsigned).digest("base64url")}`;
  const row=await f.row();
  const calls={
    store_github_user_connection:{p_profile_id:f.id,p_github_login:"synthetic-author",p_github_user_id:row.github_user_id,p_access:"forbidden",p_refresh:null,p_access_expires:null,p_refresh_expires:null,p_expected_connection:row.connection_id,p_expected_version:row.credential_version},
    claim_github_user_refresh:{p_profile_id:f.id,p_connection_id:row.connection_id,p_version:row.credential_version},
    finalize_github_user_refresh:{p_profile_id:f.id,p_connection_id:row.connection_id,p_version:row.credential_version,p_claim_id:randomUUID(),p_access:"forbidden",p_refresh:null,p_access_expires:null,p_refresh_expires:null},
    use_github_user_connection:{p_profile_id:f.id,p_connection_id:row.connection_id,p_version:row.credential_version,p_disconnect:true},
    invalidate_github_user_association:{},
  };
  const network=globalThis.fetch;
  for(const credential of [f.local.ANON_KEY,token]) {
    const headers={apikey:f.local.ANON_KEY,authorization:`Bearer ${credential}`,"content-type":"application/json"};
    for(const [name,body] of Object.entries(calls)) {
      const response=await network(`${f.local.API_URL}/rest/v1/rpc/${name}`,{method:"POST",headers,body:JSON.stringify(body)});
      expect(response.ok,`${name} unexpectedly exposed`).toBe(false);
      expect([401,403,404]).toContain(response.status);
    }
    expect((await network(`${f.local.API_URL}/rest/v1/github_app_user_tokens?select=encrypted_access_token`,{headers})).ok).toBe(false);
  }
}),30000);

it("the real comment outbox reconciles uncertain success before posting again",async()=>fixture(async f=>{
  await f.database.query("update public.task_comment_github_deliveries set status='pending',lock_token=null,locked_at=null where task_comment_id=$1",[f.commentId]);
  let created=false,writes=0;
  const existing={id:91,body:`Synthetic authored comment\n\n<!-- fmd-comment-id:${f.commentId} -->`,html_url:"https://github.com/findmydoc-platform/management/issues/1#issuecomment-91",user:{login:"synthetic-author"}};
  f.setProvider(async (request:Request)=>{
    if(request.method==="GET") return Response.json(created ? [existing] : []);
    writes++;created=true;throw new Error("lost success response");
  });
  const {deliverPendingGitHubComments}=await importTestModule("src/lib/github-comment-delivery.ts",{"server-only":{}});
  const {createClient}=await import("@supabase/supabase-js");
  const supabase=createClient(f.local.API_URL,f.local.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  expect(await deliverPendingGitHubComments({supabase,taskId:f.id})).toMatchObject({retryScheduled:1});
  await f.database.query("update public.task_comment_github_deliveries set next_attempt_at=now()-interval '1 second' where task_comment_id=$1",[f.commentId]);
  expect(await deliverPendingGitHubComments({supabase,taskId:f.id})).toMatchObject({reconciled:1,delivered:1});
  expect(writes).toBe(1);
}),30000);
