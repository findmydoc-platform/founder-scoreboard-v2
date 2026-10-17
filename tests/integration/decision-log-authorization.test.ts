import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { expect, it } from "vitest";
import { asAuthenticated, captureDatabaseError } from "./helpers/local-database";

const tables = ["decision_log", "decision_comments", "decision_confirmations", "decision_task_links"] as const;
type Table = typeof tables[number];
const privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

it("denies retired local Decision Log REST actions in every supported mode while retaining service data and foreign keys", async () => {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]);
  const local = JSON.parse(stdout) as { API_URL: string; DB_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string; JWT_SECRET: string };
  const api = new URL(local.API_URL), database = new URL(local.DB_URL);
  if (!["localhost", "127.0.0.1"].includes(api.hostname) || api.port !== "56321"
    || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "56322") throw Error("Disposable target required");
  if (process.env.DISPOSABLE_DB_URL && process.env.DISPOSABLE_DB_URL !== local.DB_URL) throw Error("Disposable database target mismatch");
  const db = new pg.Client(local.DB_URL);
  await db.connect();
  const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = randomUUID(), projectId = `decision-project-${suffix}`, taskId = `decision-task-${suffix}`;
  const actors = ["ceo", "founder", "deputy", "viewer", "administrator", "unmapped"].map(name => ({
    name, userId: randomUUID(), sessionId: randomUUID(), profileId: `decision-${name}-${suffix}`,
    subject: `decision-${name}-${suffix}`, token: "",
  }));
  const profileIds = actors.filter(actor => actor.name !== "unmapped").map(actor => actor.profileId);
  const previous = (await db.query("select mode,linking_enforced,google_activated_at from workspace_private.configuration where singleton")).rows[0];
  const owner = actors[0].profileId;
  const permits: string[] = [];
  let preserved: Record<Table, string> | undefined;

  async function seedDecision() {
    return (await db.query<{ id: string }>("insert into public.decision_log(title,context,decision,status,created_by) values($1,'Preserved context','Preserved decision','draft',$2) returning id", [`Synthetic decision ${suffix}`, owner])).rows[0].id;
  }
  async function seedRow(table: Table, decisionId: string) {
    if (table === "decision_log") return decisionId;
    if (table === "decision_comments") return (await db.query<{ id: string }>("insert into public.decision_comments(decision_id,profile_id,comment) values($1,$2,'Preserved comment') returning id", [decisionId, owner])).rows[0].id;
    if (table === "decision_confirmations") return (await db.query<{ id: string }>("insert into public.decision_confirmations(decision_id,profile_id) values($1,$2) returning id", [decisionId, owner])).rows[0].id;
    return (await db.query<{ id: string }>("insert into public.decision_task_links(decision_id,task_id,created_by,note) values($1,$2,$3,'Preserved link') returning id", [decisionId, taskId, owner])).rows[0].id;
  }
  async function snapshot(ids: Record<Table, string>) {
    return Object.fromEntries(await Promise.all(tables.map(async table => [table,
      (await db.query(`select to_jsonb(record) as value from public.${table} record where id=$1`, [ids[table]])).rows[0].value,
    ])));
  }
  function insertBody(table: Table, decisionId: string) {
    if (table === "decision_log") return { title: `Synthetic denied creation ${suffix}`, status: "draft", created_by: owner };
    if (table === "decision_comments") return { decision_id: decisionId, profile_id: owner, comment: "Denied comment" };
    if (table === "decision_confirmations") return { decision_id: decisionId, profile_id: owner };
    return { decision_id: decisionId, task_id: taskId, created_by: owner, note: "Denied link" };
  }
  const patches: Record<Table, object> = {
    decision_log: { title: "Denied title change" }, decision_comments: { comment: "Denied comment change" },
    decision_confirmations: { confirmed_at: "2026-01-01T00:00:00Z" }, decision_task_links: { note: "Denied link change" },
  };
  async function request(actor: typeof actors[number] | null, path: string, method: string, body: object | undefined, admitted: boolean) {
    const headers: Record<string, string> = { apikey: local.ANON_KEY, authorization: `Bearer ${actor?.token || local.ANON_KEY}`, "content-type": "application/json", prefer: "return=representation" };
    let permit: string | undefined;
    if (actor && admitted) {
      permit = randomUUID();
      const hash = digest(permit);
      permits.push(hash);
      const issued = await service.rpc("workspace_issue_permit", {
        p_hash: hash, p_user_id: actor.userId, p_jwt_hash: digest(actor.token), p_method: method, p_path: path.split("?")[0], p_session_id: actor.sessionId,
      });
      expect(issued.error?.code, `permit issuance for ${actor.name}/${method}/${path.split("?")[0]}`).toBeUndefined();
      const stored = (await db.query("select user_id,jwt_hash,method,path,access_generation=(select access_generation from workspace_private.configuration where singleton) as current_generation from workspace_private.request_permits where permit_hash=$1", [hash])).rows[0];
      expect(stored).toEqual({ user_id: actor.userId, jwt_hash: digest(actor.token), method, path: path.split("?")[0], current_generation: true });
      headers["x-founderops-workspace-permit"] = permit;
    }
    try {
      return await fetch(`${api.origin}/rest/v1${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    } finally {
      if (permit) expect((await service.rpc("workspace_release_permit", { p_hash: digest(permit) })).error?.code).toBeUndefined();
    }
  }

  try {
    await db.query("update workspace_private.configuration set mode='legacy',linking_enforced=false where singleton");
    for (const actor of actors) {
      await db.query("insert into auth.users(id,email,role,aud,email_confirmed_at) values($1,$2,'authenticated','authenticated',now())", [actor.userId, `${actor.subject}@example.test`]);
      await db.query("insert into auth.sessions(id,user_id,created_at) values($1,$2,now())", [actor.sessionId, actor.userId]);
      if (actor.name !== "unmapped") await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,$3,$4)", [actor.profileId, actor.userId, `Synthetic ${actor.name}`, actor.name === "administrator" ? "viewer" : actor.name]);
      await db.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values($1,'google',$2,$3)", [actor.userId, actor.subject, JSON.stringify({ sub: actor.subject, iss: "https://accounts.google.com", email: `${actor.subject}@findmydoc.eu`, email_verified: true, custom_claims: { hd: "findmydoc.eu" } })]);
      await db.query("insert into workspace_private.identity_bindings(user_id,google_subject) values($1,$2)", [actor.userId, actor.subject]);
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: actor.userId, iss: `${api.origin}/auth/v1`, aud: "authenticated", role: "authenticated", session_id: actor.sessionId, iat: now, exp: now + 3600 })}`;
      actor.token = `${unsigned}.${createHmac("sha256", local.JWT_SECRET).update(unsigned).digest("base64url")}`;
    }
    const administrator = actors.find(actor => actor.name === "administrator")!;
    await db.query("insert into public.administrator_access_grants(profile_id,eligible) values($1,true) on conflict(profile_id) do update set eligible=true", [administrator.profileId]);
    await db.query("begin");
    try {
      const activated = await asAuthenticated(db, administrator.userId, () => db.query("select public.activate_administrator_access() as access"));
      expect(activated.rows[0].access).toMatchObject({ eligible: true, active: true });
      await db.query("commit");
    } catch (error) { await db.query("rollback"); throw error; }
    expect((await db.query("select platform_role from public.profiles where id=$1", [administrator.profileId])).rows[0].platform_role).toBe("viewer");
    await db.query("insert into public.projects(id,name) values($1,'Synthetic retired-decision project')", [projectId]);
    await db.query("insert into public.tasks(id,project_id,title,status,task_type) values($1,$2,'Synthetic linked task','backlog','deliverable')", [taskId, projectId]);
    const preservedDecision = await seedDecision();
    preserved = { decision_log: preservedDecision, decision_comments: await seedRow("decision_comments", preservedDecision), decision_confirmations: await seedRow("decision_confirmations", preservedDecision), decision_task_links: await seedRow("decision_task_links", preservedDecision) };
    const before = await snapshot(preserved);

    for (const configuration of [
      { mode: "legacy", enforced: false }, { mode: "linking", enforced: false },
      { mode: "linking", enforced: true }, { mode: "google", enforced: false },
    ]) {
      await db.query("update workspace_private.configuration set mode=$1,linking_enforced=$2 where singleton", [configuration.mode, configuration.enforced]);
      if (configuration.mode === "google") await db.query("update auth.sessions set created_at=clock_timestamp() where id=any($1)", [actors.map(actor => actor.sessionId)]);
      const admitted = configuration.mode === "google" || configuration.enforced;
      if (configuration.mode === "linking" && configuration.enforced) {
        for (const actor of actors) expect((await service.rpc("workspace_record_google_login", { p_user_id: actor.userId, p_session_id: actor.sessionId, p_subject: actor.subject })).error?.code).toBeUndefined();
      }
      for (const actor of actors) {
        if (admitted) {
          const withoutPermit = await request(actor, "/rpc/workspace_request_admitted", "POST", {}, false);
          expect(withoutPermit.status).toBe(403);
          expect((await withoutPermit.json()).message).toBe("Workspace authorization required");
        }
        const positive = await request(actor, "/rpc/workspace_request_admitted", "POST", {}, admitted);
        expect(positive.status, `${configuration.mode}/${actor.name} admission control`).toBe(200);
        expect(await positive.json()).toBe(true);
      }
      for (const actor of [...actors, null]) {
        for (const table of tables) {
          const decisionId = await seedDecision(), postDecisionId = await seedDecision();
          const rowId = await seedRow(table, decisionId);
          for (const method of ["GET", "HEAD", "POST", "PATCH", "DELETE"]) {
            const path = method === "POST" ? `/${table}` : `/${table}?id=eq.${rowId}&select=id`;
            const body = method === "POST" ? insertBody(table, postDecisionId) : method === "PATCH" ? patches[table] : undefined;
            const response = await request(actor, path, method, body, admitted);
            const label = `${configuration.mode}/${configuration.enforced}/${actor?.name || "anonymous"}/${table}/${method}`;
            expect.soft(response.status, label).toBe(actor ? 403 : 401);
            if (method !== "HEAD") expect.soft((await response.json()).code, label).toBe("42501");
          }
        }
      }
      for (const table of tables) {
        const response = await fetch(`${api.origin}/rest/v1/${table}?id=eq.${preserved[table]}`, { headers: { apikey: local.SERVICE_ROLE_KEY, authorization: `Bearer ${local.SERVICE_ROLE_KEY}` } });
        expect(response.status, `${configuration.mode}/${table} service read`).toBe(200);
        expect(await response.json()).toEqual([before[table]]);
      }
      expect(await snapshot(preserved)).toEqual(before);
    }

    for (const table of tables) {
      for (const role of ["anon", "authenticated"]) {
        const allowed = await db.query("select privilege from unnest($3::text[]) privilege where has_table_privilege($1,$2,privilege)", [role, `public.${table}`, privileges]);
        expect.soft(allowed.rows, `${role}/${table} table ACL`).toEqual([]);
        const sequence = await db.query("select privilege from unnest(array['USAGE','SELECT','UPDATE']) privilege where has_sequence_privilege($1,$2,privilege)", [role, `public.${table}_id_seq`]);
        expect.soft(sequence.rows, `${role}/${table} sequence ACL`).toEqual([]);
      }
      const publicGrants = await db.query(`select acl.privilege_type from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace cross join lateral aclexplode(coalesce(relation.relacl,acldefault((case when relation.relkind='S' then 'S' else 'r' end)::"char",relation.relowner))) acl where namespace.nspname='public' and relation.relname=any($1) and acl.grantee=0`, [[table, `${table}_id_seq`]]);
      expect.soft(publicGrants.rows, `${table} PUBLIC ACL`).toEqual([]);
      const servicePrivileges = table === "decision_comments" ? privileges.filter(privilege => privilege !== "UPDATE" && privilege !== "DELETE") : privileges;
      expect((await db.query("select bool_and(has_table_privilege('service_role',$1,privilege)) as retained from unnest($2::text[]) privilege", [`public.${table}`, servicePrivileges])).rows[0].retained).toBe(true);
      expect((await db.query("select bool_and(has_sequence_privilege('service_role',$1,privilege)) as retained from unnest(array['USAGE','SELECT','UPDATE']) privilege", [`public.${table}_id_seq`])).rows[0].retained).toBe(true);
      expect((await db.query("select relrowsecurity from pg_class where oid=$1::regclass", [`public.${table}`])).rows[0].relrowsecurity).toBe(true);
      expect.soft((await db.query("select policyname from pg_policies where schemaname='public' and tablename=$1 and permissive='PERMISSIVE'", [table])).rows, `${table} obsolete human policies`).toEqual([]);
      expect((await db.query("select permissive,cmd from pg_policies where schemaname='public' and tablename=$1 and policyname='workspace_request_boundary'", [table])).rows).toEqual([{ permissive: "RESTRICTIVE", cmd: "ALL" }]);
    }
    await db.query("begin");
    try {
      for (const table of tables.slice(1)) {
        const body = insertBody(table, "-1");
        const keys = Object.keys(body);
        const missingParent = await captureDatabaseError(db, () => db.query(`insert into public.${table}(${keys.join(",")}) values(${keys.map((_, index) => `$${index + 1}`).join(",")})`, Object.values(body)));
        expect(missingParent).toMatchObject({ code: "23503" });
      }
      for (const [table, column] of [["decision_log", "created_by"], ["decision_comments", "profile_id"], ["decision_confirmations", "profile_id"], ["decision_task_links", "created_by"], ["decision_task_links", "task_id"]] as const) {
        const invalidReference = await captureDatabaseError(db, () => db.query(`update public.${table} set ${column}=$1 where id=$2`, [`missing-${suffix}`, preserved![table]]));
        expect(invalidReference).toMatchObject({ code: "23503" });
      }
      expect(await captureDatabaseError(db, () => db.query("delete from public.profiles where id=$1", [owner]))).toMatchObject({ code: "23503", constraint: "decision_task_links_created_by_fkey" });
      await db.query("delete from public.decision_log where id=$1", [preserved.decision_log]);
      for (const table of tables.slice(1)) expect((await db.query(`select count(*)::integer as count from public.${table} where id=$1`, [preserved[table]])).rows[0].count).toBe(0);
    } finally { await db.query("rollback"); }
    expect(await snapshot(preserved)).toEqual(before);
    await db.query("begin");
    try {
      await db.query("select set_config('founderops.trash_lifecycle_write','on',true)");
      await db.query("delete from public.tasks where id=$1", [taskId]);
      expect((await db.query("select count(*)::integer as count from public.decision_task_links where id=$1", [preserved.decision_task_links])).rows[0].count).toBe(0);
      expect((await db.query("select count(*)::integer as count from public.decision_log where id=$1", [preserved.decision_log])).rows[0].count).toBe(1);
    } finally { await db.query("rollback"); }
    expect(await snapshot(preserved)).toEqual(before);
  } finally {
    try {
      await db.query("rollback");
      await db.query("delete from workspace_private.request_permits where permit_hash=any($1)", [permits]);
      await db.query("delete from public.decision_log where created_by=any($1)", [profileIds]);
      await db.query("begin");
      try {
        await db.query("select set_config('founderops.trash_lifecycle_write','on',true)");
        await db.query("delete from public.tasks where id=$1", [taskId]);
        await db.query("commit");
      } catch (error) { await db.query("rollback"); throw error; }
      await db.query("delete from public.projects where id=$1", [projectId]);
      await db.query("delete from workspace_private.google_login_sessions where user_id=any($1)", [actors.map(actor => actor.userId)]);
      await db.query("delete from workspace_private.identity_bindings where user_id=any($1)", [actors.map(actor => actor.userId)]);
      await db.query("delete from public.profiles where id=any($1)", [profileIds]);
      await db.query("delete from auth.users where id=any($1)", [actors.map(actor => actor.userId)]);
    } finally {
      try {
        await db.query("update workspace_private.configuration set mode=$1,linking_enforced=$2 where singleton", [previous.mode, previous.linking_enforced]);
        await db.query("update workspace_private.configuration set google_activated_at=$1 where singleton", [previous.google_activated_at]);
      } finally { await db.end(); }
    }
  }
}, 30000);
