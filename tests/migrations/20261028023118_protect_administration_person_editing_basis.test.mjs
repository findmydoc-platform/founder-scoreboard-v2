import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";
const filename="20261028023118_protect_administration_person_editing_basis.sql";
const directory=resolve("supabase/migrations"), migration=resolve(directory,filename);
const previousVersion=readdirSync(directory).filter(name=>name.endsWith(".sql")&&name<filename).sort().at(-1).slice(0,14);
const users=Object.fromEntries(["ceo","admin","founder","deputy","viewer","unmapped"].map((role,index)=>[role,`76000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`]));
async function beginAs(client,role,user){await client.query("begin");await client.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role',$3,true)",[JSON.stringify({role,...(user?{sub:user}:{})}),user||"",role]);await client.query(`set local role ${role}`);}
async function as(client,user,operation,role="authenticated"){await beginAs(client,role,user);try{const result=await operation();await client.query("commit");return result;}catch(error){await client.query("rollback");throw error;}}
const raw={github_login:null,google_chat_user_id:null,google_chat_dm_space:""};
const technical=(client,id,patch,expected=raw,user=users.admin)=>as(client,user,()=>client.query("select public.update_profile_technical_identity_transaction($1,$2::jsonb,null,null) result",[id,JSON.stringify({...patch,...(expected===undefined?{}:{__expected_technical_identity:expected})})]));
const eligibility=(client,id,expected,eligible,user=users.ceo)=>as(client,user,()=>client.query("select public.set_administrator_eligibility_if_current($1,$2,$3) result",[id,expected,eligible]));
const legacy=(client,id,eligible,user=users.ceo)=>as(client,user,()=>client.query("select public.set_administrator_eligibility($1,$2) result",[id,eligible]));
async function snapshot(client){const out={};for(const table of ["profiles","administrator_access_grants","audit_log"])out[table]=(await client.query(`select to_jsonb(row) data from public.${table} row order by to_jsonb(row)::text`)).rows;out.acl=(await client.query("select proname,proacl::text from pg_proc where pronamespace='public'::regnamespace and proname=any($1) order by proname",[["update_profile_technical_identity_transaction","set_administrator_eligibility","administrator_directory_snapshot"]])).rows;return out;}
async function waiting(client,pid){for(let attempt=0;attempt<100;attempt++){if((await client.query("select cardinality(pg_blocking_pids($1))>0 waiting",[pid])).rows[0].waiting)return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error("Expected writer did not wait for its target profile");}
async function race(client,id,firstSql,firstValues,second,expectConflict=true){await withLocalDatabase(async other=>{const pid=(await other.query("select pg_backend_pid() pid")).rows[0].pid;await beginAs(client,"authenticated",users.ceo);try{await client.query(firstSql,firstValues);const outcome=second(other).then(value=>({value}),error=>({error}));await waiting(client,pid);await client.query("commit");const result=await outcome;if(expectConflict)expect(result.error).toMatchObject({code:"P0020"});else{expect(result.error).toBeUndefined();expect(result.value).toBeDefined();}}finally{await client.query("rollback");}});}
it("preserves person data and actors while both old and new writers honor original bases under real waits",{timeout:120000},async()=>{
 await resetLocalDatabaseTo(previousVersion);
 await withLocalDatabase(async client=>{
  await client.query("insert into auth.users(id) select unnest($1::uuid[])",[Object.values(users)]);
  for(const role of ["ceo","admin","founder","deputy","viewer"])await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,$3,$4)",[`person-${role}`,users[role],role,role==="admin"?"founder":role]);
  for(const id of ["target","partial","race-present","race-absent","race-reverse","technical-race","expiry-technical","expiry-eligibility","grant-expiry-legacy","grant-expiry-cas"])await client.query("insert into public.profiles(id,name,platform_role,github_login,google_chat_user_id,google_chat_dm_space) values($1,$1,'founder',null,null,'')",[id]);
  await client.query("insert into public.administrator_access_grants(profile_id,eligible,active_until) values('person-admin',true,clock_timestamp()+interval '1 hour'),('race-present',false,null),('grant-expiry-legacy',false,null),('grant-expiry-cas',false,null),('person-founder',true,null)");
  const before=await snapshot(client);await applyMigration(client,migration);expect(await snapshot(client)).toEqual(before);
  const missing=await client.query("select to_regprocedure('public.set_administrator_eligibility_if_current(text,boolean,boolean)') procedure");expect(missing.rows[0].procedure).not.toBeNull();
  for(const role of ["founder","deputy","viewer","unmapped"]){await expect(technical(client,"target",{github_login:"denied"},raw,users[role])).rejects.toMatchObject({code:"42501"});await expect(eligibility(client,"target",false,true,users[role])).rejects.toMatchObject({code:"42501"});await expect(legacy(client,"target",true,users[role])).rejects.toMatchObject({code:"42501"});}
  await expect(technical(client,"target",{github_login:"denied"},raw,users.ceo)).rejects.toMatchObject({code:"42501"});
  for(const role of ["anon"]){await expect(as(client,null,()=>client.query("select public.set_administrator_eligibility_if_current('target',false,true)"),role)).rejects.toMatchObject({code:"42501"});await expect(as(client,null,()=>client.query("select public.update_profile_technical_identity_transaction('target','{}',null,null)"),role)).rejects.toMatchObject({code:"42501"});}
  for(const expected of [null,[],"bad",{}, {...raw,extra:"bad"},{...raw,github_login:1}])await expect(technical(client,"target",{github_login:"bad"},expected)).rejects.toMatchObject({code:"22023"});
  await expect(eligibility(client,"target",null,true)).rejects.toMatchObject({code:"22023"});await expect(eligibility(client,"missing",false,true)).rejects.toMatchObject({code:"P0002"});
  const unchanged=await snapshot(client);await expect(technical(client,"target",{github_login:"bad"},{...raw,github_login:""})).rejects.toMatchObject({code:"P0019"});await expect(eligibility(client,"target",true,false)).rejects.toMatchObject({code:"P0020"});expect(await snapshot(client)).toEqual(unchanged);
  const saved=await technical(client,"target",{github_login:"actual-login"});expect(saved.rows[0].result).toEqual({profile:{id:"target",github_login:"actual-login",google_chat_user_id:null,google_chat_dm_space:""}});
  const audit=(await client.query("select before_data,after_data from public.audit_log where entity_id='target' order by id desc limit 1")).rows[0];expect(JSON.stringify(audit)).not.toContain("__expected_technical_identity");
  expect((await eligibility(client,"target",false,true)).rows[0].result).toMatchObject({profileId:"target",eligible:true});
  expect((await eligibility(client,"target",true,false,users.admin)).rows[0].result).toMatchObject({profileId:"target",eligible:false});
  await as(client,users.admin,()=>client.query("select public.update_profile_technical_identity_transaction($1,$2::jsonb,null,null)",["target",JSON.stringify({github_login:"legacy-login"})]));await legacy(client,"target",true);
  await technical(client,"partial",{github_login:"first-confirmed"});const first=await snapshot(client);await expect(eligibility(client,"partial",true,false)).rejects.toMatchObject({code:"P0020"});expect(await snapshot(client)).toEqual(first);
  const directory=(await as(client,users.admin,()=>client.query("select public.administrator_directory_snapshot() result"))).rows[0].result;expect(directory.people.find(person=>person.id==="target").technicalBasis).toEqual({githubLogin:"legacy-login",googleChatUserId:null,googleChatDmSpace:""});
  const reduced=(await as(client,users.ceo,()=>client.query("select public.administrator_directory_snapshot() result"))).rows[0].result;expect(reduced.people.find(person=>person.id==="target").technicalBasis).toBeNull();
  for(const id of ["race-present","race-absent"])await race(client,id,"select public.set_administrator_eligibility($1,true)",[id],other=>eligibility(other,id,false,false));
  await race(client,"race-reverse","select public.set_administrator_eligibility_if_current($1,false,true)",["race-reverse"],other=>legacy(other,"race-reverse",false),false);
  expect((await client.query("select eligible from public.administrator_access_grants where profile_id='race-reverse'")).rows[0].eligible).toBe(false);
  await withLocalDatabase(async other=>{const pid=(await other.query("select pg_backend_pid() pid")).rows[0].pid;await beginAs(client,"authenticated",users.admin);await client.query("select public.update_profile_technical_identity_transaction('technical-race','{\"github_login\":\"legacy-first\"}',null,null)");const outcome=technical(other,"technical-race",{github_login:"stale-second"}).then(value=>({value}),error=>({error}));await waiting(client,pid);await client.query("commit");expect((await outcome).error).toMatchObject({code:"P0019"});});
  for(const step of ["technical","eligibility"])await withLocalDatabase(async other=>{const id=`expiry-${step}`;await client.query("update public.administrator_access_grants set active_until=clock_timestamp()+interval '1 second' where profile_id='person-admin'");const pid=(await other.query("select pg_backend_pid() pid")).rows[0].pid;const prior=await snapshot(client);await client.query("begin");try{await client.query("select id from public.profiles where id=$1 for update",[id]);const outcome=(step==="technical"?technical(other,id,{github_login:"expired"}):eligibility(other,id,false,true,users.admin)).then(value=>({value}),error=>({error}));await waiting(client,pid);await client.query("select pg_sleep(1.1)");await client.query("commit");expect((await outcome).error).toMatchObject({code:"42501"});expect(await snapshot(client)).toEqual(prior);}finally{await client.query("rollback");}});
  // A technical audit takes KEY SHARE on its actor profile. Eligibility must not
  // retain a conflicting profile lock while it waits for that actor's grant.
  await client.query("update public.administrator_access_grants set active_until=clock_timestamp()+interval '1 hour' where profile_id in ('person-admin','person-founder')");
  await withLocalDatabase(async other=>{
    const pid=(await other.query("select pg_backend_pid() pid")).rows[0].pid;
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role','authenticated',true)",[JSON.stringify({role:"authenticated",sub:users.founder}),users.founder]);
    let outcome;
    try {
      await client.query("select profile_id from public.administrator_access_grants where profile_id='person-founder' for update");
      await client.query("select id from public.profiles where id='person-admin' for update");
      outcome=legacy(other,"person-founder",true,users.admin).then(value=>({value}),error=>({error}));
      await waiting(client,pid);
      await client.query("set local role authenticated");
      await client.query("select public.update_profile_technical_identity_transaction('person-admin','{\"github_login\":\"audit-cycle\"}',null,null)");
      await client.query("commit");
      const result=await outcome;
      expect(result.error).toBeUndefined();
      expect(result.value.rows[0].result).toMatchObject({profileId:"person-founder",eligible:true});
    } finally {
      await client.query("rollback");
      if(outcome)await outcome;
    }
  });
  for(const kind of ["legacy","cas"])await withLocalDatabase(async other=>{
    const id=`grant-expiry-${kind}`;
    await client.query("update public.administrator_access_grants set active_until=clock_timestamp()+interval '1 second' where profile_id='person-admin'");
    const pid=(await other.query("select pg_backend_pid() pid")).rows[0].pid;
    const prior=await snapshot(client);
    await client.query("begin");
    let outcome;
    try {
      await client.query("select profile_id from public.administrator_access_grants where profile_id=$1 for update",[id]);
      outcome=(kind==="legacy"?legacy(other,id,true,users.admin):eligibility(other,id,false,true,users.admin)).then(value=>({value}),error=>({error}));
      await waiting(client,pid);
      await client.query("select pg_sleep(1.1)");
      await client.query("commit");
      expect((await outcome).error).toMatchObject({code:"42501"});
      expect(await snapshot(client)).toEqual(prior);
    } finally {
      await client.query("rollback");
      if(outcome)await outcome;
    }
  });
  await applyMigration(client,migration);
 });
});
