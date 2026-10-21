import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient, type Session } from "@supabase/supabase-js";
import { localSupabaseStatus } from "../../helpers/local-supabase-target.mjs";

/** Synthetic OAuth session state; token signing, refresh, user checks and REST remain real. */
export async function createCalendarLiveFixture() {
  const local = await localSupabaseStatus();
  const database = new pg.Client(local.DB_URL);
  await database.connect();
  const previous = (await database.query("select mode,linking_enforced from workspace_private.configuration")).rows[0];
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, options);
  const actors: { userId: string; profileId: string }[] = [];
  async function actor(role = "viewer") {
    const suffix = randomUUID();
    const email = `${suffix}@example.test`, password = randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Synthetic Auth account creation failed");
    const userId = created.data.user.id, profileId = `live-calendar-${suffix}`;
    actors.push({ userId, profileId });
    const client = createClient(local.API_URL, local.ANON_KEY, options);
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error || !login.data.session) throw new Error("Synthetic Auth sign-in failed");
    const sessionId = JSON.parse(Buffer.from(login.data.session.access_token.split(".")[1], "base64url").toString()).session_id;
    await database.query("insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at) values($1,$2,'oauth',now(),now())", [randomUUID(),sessionId]);
    const refreshed = await client.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) throw new Error("Synthetic OAuth session refresh failed");
    const session: Session = refreshed.data.session;
    const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString());
    const header = JSON.parse(Buffer.from(session.access_token.split(".")[0], "base64url").toString());
    if (header.alg !== "ES256" || !header.kid || !claims.amr.some((entry: { method: string }) => entry.method === "oauth")) throw new Error("Expected real asymmetric Auth OAuth-AMR credential");
    if ((await client.auth.getUser(session.access_token)).error) throw new Error("Real Auth did not accept its credential");
    await database.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,'Synthetic Calendar',$3)", [profileId,userId,role]);
    await database.query("insert into auth.identities(user_id,provider,provider_id,identity_data,created_at,updated_at,last_sign_in_at) values($1,'google',$2,$3,now(),now(),now())", [userId,suffix,JSON.stringify({ sub: suffix,iss:"https://accounts.google.com",email:`${suffix}@findmydoc.eu`,email_verified:true,custom_claims:{hd:"findmydoc.eu"} })]);
    await database.query("insert into workspace_private.identity_bindings(user_id,google_subject) values($1,$2)", [userId,suffix]);
    if ((await database.query("select mode from workspace_private.configuration")).rows[0].mode === "linking") {
      await database.query("select public.workspace_record_google_login($1,$2,$3)", [userId,sessionId,suffix]);
    }
    return { userId,profileId,sessionId,session,client };
  }
  async function publish(profileId: string, count = 1) {
    await database.query(`with versions as (
      insert into public.team_workweek_versions(owner_profile_id,effective_from)
      select $1,date '2026-10-19' + (n*7) from generate_series(0,$2::integer-1) n returning id,owner_profile_id,effective_from
    ) insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,publication_revision,published_at,last_sync_at)
      select id,owner_profile_id,effective_from,'[]','published','confirmed',row_number() over(order by effective_from)::integer,now(),now() from versions`, [profileId,count]);
  }
  return { local,database,admin,actor,publish,
    async mode(mode: string, enforced = true) { await database.query("update workspace_private.configuration set mode=$1,linking_enforced=$2", [mode,enforced]); },
    async close() {
      for (const {userId,profileId} of actors.reverse()) {
        await database.query("update public.team_workweek_publications set effective_to=null,superseded_by_publication_id=null where owner_profile_id=$1",[profileId]);
        await database.query("delete from workspace_private.identity_bindings where user_id=$1", [userId]);
        await database.query("delete from workspace_private.google_login_sessions where user_id=$1", [userId]);
        await database.query("delete from public.profiles where id=$1", [profileId]);
        const removed = await admin.auth.admin.deleteUser(userId);
        if (removed.error && removed.error.status !== 404) throw new Error("Synthetic Auth cleanup failed");
      }
      await database.query("update workspace_private.configuration set mode=$1,linking_enforced=$2", [previous.mode,previous.linking_enforced]);
      await database.end();
    },
  };
}
