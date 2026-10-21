import { createHash } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { verifyWorkspaceSecurity } from "../../scripts/lib/database-security/workspace-security.mjs";
import { asAuthenticated, captureDatabaseError, localDatabaseUrl, withIsolatedLocalDatabase } from "./helpers/local-database";

const uid = "64000000-0000-4000-8000-000000000025";
const sid = "64000000-0000-4000-8000-000000000026";
const profileId = "calendar-dispatch-member";
const identity = { sub: "calendar-dispatch-sub", email: "calendar@findmydoc.eu", email_verified: true,
  iss: "https://accounts.google.com", custom_claims: { hd: "findmydoc.eu" } };
const signature = "public.workspace_calendar_prepare(text,uuid,text,text,text,uuid,text,text,boolean,text,text)";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const preparation = "select public.workspace_calendar_prepare($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as required";
function parameters(overrides: Record<string, unknown> = {}) {
  const binding = { hash: digest("calendar-permit"), user: uid, jwt: digest("calendar-jwt"), method: "POST",
    path: "/rpc/current_authenticated_profile", session: sid, profile: profileId, mode: "linking", enforced: true,
    subject: identity.sub, email: identity.email, ...overrides };
  return [binding.hash,binding.user,binding.jwt,binding.method,binding.path,binding.session,binding.profile,
    binding.mode,binding.enforced,binding.subject,binding.email];
}
async function seed(client: pg.Client) {
  await client.query("insert into auth.users(id) values ($1)", [uid]);
  await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ($1,$2,'Calendar viewer','viewer')", [profileId, uid]);
  await client.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'google','calendar-dispatch-sub',$2)", [uid, JSON.stringify(identity)]);
  await client.query("insert into workspace_private.identity_bindings(user_id,google_subject) values ($1,$2)", [uid,identity.sub]);
  await client.query("insert into auth.sessions(id,user_id,created_at) values ($1,$2,clock_timestamp())", [sid,uid]);
  await client.query("update workspace_private.configuration set mode='linking',linking_enforced=true");
  await client.query("select public.workspace_record_google_login($1,$2,$3)", [uid,sid,identity.sub]);
}

it("prepares the original profile request and enforces the existing user grant and one-use permit", async () => {
  await withIsolatedLocalDatabase(async client => {
    await seed(client);
    expect((await client.query(preparation,parameters())).rows[0]).toEqual({ required: true });
    await client.query("select set_config('request.method','POST',true),set_config('request.path','/rpc/current_authenticated_profile',true),set_config('request.headers',$1,true)", [JSON.stringify({ authorization: "Bearer calendar-jwt", "x-founderops-workspace-permit": "calendar-permit" })]);
    await asAuthenticated(client,uid,async () => {
      await client.query("select public.workspace_check_request()");
      expect((await client.query("select public.current_authenticated_profile() as profile")).rows[0].profile)
        .toMatchObject({ id: profileId, platform_role: "viewer" });
    });
    expect(await captureDatabaseError(client,() => asAuthenticated(client,uid,() => client.query("select public.workspace_check_request()"))))
      .toMatchObject({ code: "42501" });
  });
});

it.each(["profile", "user", "mode", "enforced", "subject", "email", "session"])("rejects changed %s before issuing a permit", async field => {
  await withIsolatedLocalDatabase(async client => {
    await seed(client);
    const overrides = { [field]: field === "enforced" ? false : field === "user" || field === "session"
      ? "64000000-0000-4000-8000-000000000099" : "changed" };
    expect(await captureDatabaseError(client,() => client.query(preparation,parameters(overrides)))).toMatchObject({ code: "42501" });
    expect((await client.query("select permit_hash from workspace_private.request_permits where user_id=$1",[uid])).rows).toEqual([]);
  });
});

it.each([
  { ...identity, email_verified: "true" }, { ...identity, email_verified: 1 },
  { ...identity, sub: 123 }, { ...identity, sub: "" }, { ...identity, email: 123 }, { ...identity, email: "" },
  { ...identity, iss: "https://untrusted.example.test" }, { ...identity, iss: ["accounts.google.com"] }, { ...identity, custom_claims: { hd: 123 } },
])("denies malformed live identity %# without inserting a permit", async malformed => {
  await withIsolatedLocalDatabase(async client => {
    await seed(client);
    await client.query("update auth.identities set identity_data=$1 where user_id=$2",[JSON.stringify(malformed),uid]);
    const subject = String(malformed.sub); const email = String(malformed.email);
    await client.query("update workspace_private.identity_bindings set google_subject=$1 where user_id=$2",[subject,uid]);
    await client.query("update workspace_private.google_login_sessions set google_subject=$1 where user_id=$2",[subject,uid]);
    expect(await captureDatabaseError(client,() => client.query(preparation,parameters({ subject,email })))).toMatchObject({ code: "42501" });
    expect((await client.query("select permit_hash from workspace_private.request_permits where user_id=$1",[uid])).rows).toEqual([]);
  });
});

it("rejects removed sessions and removed or duplicate Google identities", async () => {
  await withIsolatedLocalDatabase(async client => {
    await seed(client);
    await client.query("delete from auth.sessions where id=$1",[sid]);
    expect(await captureDatabaseError(client,() => client.query(preparation,parameters()))).toMatchObject({ code: "42501" });
    await client.query("insert into auth.sessions(id,user_id,created_at) values ($1,$2,clock_timestamp())", [sid,uid]);
    await client.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'google','calendar-other-sub',$2)",[uid,JSON.stringify(identity)]);
    expect(await captureDatabaseError(client,() => client.query(preparation,parameters()))).toMatchObject({ code: "42501" });
    expect((await client.query("select permit_hash from workspace_private.request_permits where user_id=$1",[uid])).rows).toEqual([]);
  });
});

it.each(["legacy","linking"])("validates current profile in %s without requiring Google session admission",async mode => {
  await withIsolatedLocalDatabase(async client => {
    await seed(client);
    await client.query("update workspace_private.configuration set mode=$1,linking_enforced=false",[mode]);
    await client.query("delete from auth.sessions where id=$1",[sid]);
    expect((await client.query(preparation,parameters({ mode,enforced: false,subject: null,email: null }))).rows[0]).toEqual({ required: false });
    expect(await captureDatabaseError(client,() => client.query(preparation,parameters({ mode,enforced: false,profile: "forged" })))).toMatchObject({ code: "42501" });
    expect((await client.query("select permit_hash from workspace_private.request_permits where user_id=$1",[uid])).rows).toEqual([]);
  });
});

it("restricts execution to the server role with fixed ownership and search path", async () => {
  await withIsolatedLocalDatabase(async client => {
    await seed(client);
    expect((await client.query("select pg_get_userbyid(proowner) as owner,prosecdef,proconfig from pg_proc where oid=$1::regprocedure",[signature])).rows[0])
      .toEqual({ owner: "postgres", prosecdef: true, proconfig: ['search_path=""'] });
    for (const role of ["anon","authenticated"]) {
      expect((await client.query("select has_function_privilege($1,$2,'execute') as allowed",[role,signature])).rows[0].allowed).toBe(false);
      expect(await captureDatabaseError(client,async () => {
        await client.query(`set local role ${role}`); await client.query(preparation,parameters());
      })).toMatchObject({ code: "42501" });
    }
    expect((await client.query("select has_function_privilege('service_role',$1,'execute') as allowed",[signature])).rows[0].allowed).toBe(true);
    await client.query("set local role service_role");
    expect((await client.query(preparation,parameters())).rows[0].required).toBe(true);
    await client.query("reset role");
  });
});

it.each(["jwt","user","method","path","expiry","generation"])("preserves permit rejection for changed %s",async scenario => {
  await withIsolatedLocalDatabase(async client => {
    await seed(client); await client.query(preparation,parameters());
    if (scenario === "expiry") await client.query("update workspace_private.request_permits set expires_at=clock_timestamp()-interval '1 second' where user_id=$1",[uid]);
    if (scenario === "generation") await client.query("update workspace_private.configuration set linking_enforced=false");
    if (scenario === "generation") await client.query("update workspace_private.configuration set linking_enforced=true");
    await client.query("select set_config('request.method',$1,true),set_config('request.path',$2,true),set_config('request.headers',$3,true)",[
      scenario === "method" ? "GET" : "POST",scenario === "path" ? "/profiles" : "/rpc/current_authenticated_profile",
      JSON.stringify({ authorization: scenario === "jwt" ? "Bearer forged" : "Bearer calendar-jwt", "x-founderops-workspace-permit": "calendar-permit" })]);
    expect(await captureDatabaseError(client,() => asAuthenticated(client,scenario === "user" ? sid : uid,() => client.query("select public.workspace_check_request()"))))
      .toMatchObject({ code: "42501" });
  });
});

async function waitUntilBlocked(observer: pg.Client, waiterPid: number) {
  for (let attempt=0;attempt<100;attempt++) {
    if ((await observer.query("select cardinality(pg_blocking_pids($1))>0 as blocked",[waiterPid])).rows[0].blocked) return;
    await new Promise(resolve => setTimeout(resolve,10));
  }
  throw new Error("Expected concurrent configuration lock was not observed");
}

it("revalidates configuration after a lock wait instead of issuing a new-generation permit for old context",async () => {
  const connectionString=await localDatabaseUrl(); const owner=new pg.Client(connectionString); const waiter=new pg.Client(connectionString);
  await owner.connect(); await waiter.connect();
  let previous: { mode: string; linking_enforced: boolean; google_activated_at: string | null } | undefined;
  try {
    previous=(await owner.query("select mode,linking_enforced,google_activated_at from workspace_private.configuration")).rows[0];
    await seed(owner);
    await owner.query("begin"); await owner.query("update workspace_private.configuration set mode='legacy',linking_enforced=false");
    const pid=(await waiter.query("select pg_backend_pid() as pid")).rows[0].pid;
    const result=waiter.query(preparation,parameters()).then(() => ({ code: "unexpected_success" }),error => error);
    await waitUntilBlocked(owner,pid); await owner.query("commit");
    expect(await result).toMatchObject({ code: "42501" });
    expect((await owner.query("select permit_hash from workspace_private.request_permits where user_id=$1",[uid])).rows).toEqual([]);
  } finally {
    await owner.query("rollback").catch(() => undefined); await waiter.query("rollback").catch(() => undefined);
    await owner.query("delete from workspace_private.google_login_sessions where user_id=$1",[uid]);
    await owner.query("delete from workspace_private.identity_bindings where user_id=$1",[uid]);
    await owner.query("delete from public.profiles where id=$1",[profileId]); await owner.query("delete from auth.users where id=$1",[uid]);
    if(previous) await owner.query("update workspace_private.configuration set mode=$1,linking_enforced=$2,google_activated_at=$3",[previous.mode,previous.linking_enforced,previous.google_activated_at]);
    await Promise.all([owner.end(),waiter.end()]);
  }
});


it("holds the configuration lock until issuance commits and invalidates the old permit after a policy change",async () => {
  const connectionString=await localDatabaseUrl(); const owner=new pg.Client(connectionString); const changer=new pg.Client(connectionString);
  await owner.connect(); await changer.connect();
  let previous: { mode: string; linking_enforced: boolean; google_activated_at: string | null } | undefined;
  try {
    previous=(await owner.query("select mode,linking_enforced,google_activated_at from workspace_private.configuration")).rows[0];
    await seed(owner);
    await owner.query("begin"); expect((await owner.query(preparation,parameters())).rows[0].required).toBe(true);
    const pid=(await changer.query("select pg_backend_pid() as pid")).rows[0].pid;
    const changed=changer.query("update workspace_private.configuration set mode='legacy',linking_enforced=false");
    await waitUntilBlocked(owner,pid); await owner.query("commit"); await changed;
    await owner.query("update workspace_private.configuration set mode='linking',linking_enforced=true");
    await owner.query("begin");
    await owner.query("select set_config('request.method','POST',true),set_config('request.path','/rpc/current_authenticated_profile',true),set_config('request.headers',$1,true)",[JSON.stringify({ authorization: "Bearer calendar-jwt", "x-founderops-workspace-permit": "calendar-permit" })]);
    expect(await captureDatabaseError(owner,() => asAuthenticated(owner,uid,() => owner.query("select public.workspace_check_request()"))))
      .toMatchObject({ code: "42501" });
    await owner.query("rollback");
  } finally {
    await owner.query("rollback").catch(() => undefined); await changer.query("rollback").catch(() => undefined);
    await owner.query("delete from workspace_private.request_permits where user_id=$1",[uid]);
    await owner.query("delete from workspace_private.google_login_sessions where user_id=$1",[uid]);
    await owner.query("delete from workspace_private.identity_bindings where user_id=$1",[uid]);
    await owner.query("delete from public.profiles where id=$1",[profileId]); await owner.query("delete from auth.users where id=$1",[uid]);
    if(previous) await owner.query("update workspace_private.configuration set mode=$1,linking_enforced=$2,google_activated_at=$3",[previous.mode,previous.linking_enforced,previous.google_activated_at]);
    await Promise.all([owner.end(),changer.end()]);
  }
});


it("fails the security verifier when preparation execution or its fixed search path is weakened",async () => {
  await withIsolatedLocalDatabase(async client => {
    const baseline: string[] = []; await verifyWorkspaceSecurity(client,baseline); expect(baseline).toEqual([]);
    for (const statement of [
      `grant execute on function ${signature} to authenticated`,
      `revoke execute on function ${signature} from service_role`,
      `alter function ${signature} set search_path=public`,
    ]) {
      await client.query("savepoint preparation_contract");
      await client.query(statement);
      const failures: string[] = []; await verifyWorkspaceSecurity(client,failures); expect(failures.length).toBeGreaterThan(0);
      await client.query("rollback to savepoint preparation_contract"); await client.query("release savepoint preparation_contract");
    }
  });
});
