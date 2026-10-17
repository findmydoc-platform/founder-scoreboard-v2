import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

it("blocks direct REST, RPC and Storage while the server relay retains user-context RLS", async () => {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]);
  const local = JSON.parse(stdout);
  if (!new Set(["localhost", "127.0.0.1"]).has(new URL(local.API_URL).hostname)) throw new Error("Local test target required");
  const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const userClient = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false } });
  const database = new pg.Client(local.DB_URL);
  await database.connect();
  const suffix = randomUUID();
  const email = `${suffix}@example.com`;
  const password = randomUUID();
  const profile = `http-${suffix}`;
  const image = `quicklinks/2026-09-26/${suffix}.png`;
  let userId: string | undefined;
  let otherUserId: string | undefined;
  try {
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    userId = created.data.user!.id;
    await database.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ($1,$2,'HTTP test','founder')", [profile,userId]);
    await database.query("insert into workspace_private.identity_bindings(user_id,google_subject) values ($1,$2)", [userId,suffix]);
    await database.query("update workspace_private.configuration set mode='google'");
    const signedIn = await userClient.auth.signInWithPassword({ email, password });
    expect(signedIn.error).toBeNull();
    const token = signedIn.data.session!.access_token;
    const sessionId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).session_id as string;
    const headers = { apikey: local.ANON_KEY, authorization: `Bearer ${token}` };
    const [encodedHeader, encodedClaims] = token.split(".");
    const tampered = `${encodedHeader}.${encodedClaims}.${Buffer.alloc(32).toString("base64url")}`;
    const expiredClaims = { ...JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8")), exp: Math.floor(Date.now()/1000)-60 };
    const expiredUnsigned = `${encodedHeader}.${Buffer.from(JSON.stringify(expiredClaims)).toString("base64url")}`;
    const expired = `${expiredUnsigned}.${createHmac("sha256", local.JWT_SECRET).update(expiredUnsigned).digest("base64url")}`;
    for (const invalid of [tampered, expired]) {
      expect((await fetch(`${local.API_URL}/rest/v1/profiles?select=id`, { headers: { ...headers, authorization: `Bearer ${invalid}` } })).status).toBe(401);
    }
    expect((await fetch(`${local.API_URL}/rest/v1/profiles?select=id`, { headers })).status).toBe(403);
    expect((await fetch(`${local.API_URL}/rest/v1/rpc/current_authenticated_profile`, { method: "POST", headers })).status).toBe(403);
    const permit = randomUUID();
    const digest = async (value: string) => (await database.query<{ hash: string }>("select encode(digest($1, 'sha256'), 'hex') as hash", [value])).rows[0].hash;
    const issued = await service.rpc("workspace_issue_permit", { p_hash:await digest(permit),p_user_id:userId,p_jwt_hash:await digest(token),p_method:"GET",p_path:"/profiles",p_session_id:sessionId });
    expect(issued.error).toBeNull();
    const accepted = await fetch(`${local.API_URL}/rest/v1/profiles?select=id&id=eq.${profile}`, { headers: { ...headers, "x-founderops-workspace-permit":permit } });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual([{ id: profile }]);
    const otherEmail = `${randomUUID()}@example.test`;
    const otherPassword = randomUUID();
    const otherCreated = await service.auth.admin.createUser({ email: otherEmail, password: otherPassword, email_confirm: true });
    expect(otherCreated.error).toBeNull();
    otherUserId = otherCreated.data.user!.id;
    await database.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ($1,$2,'Other HTTP test','founder')", [`other-${profile}`, otherUserId]);
    await database.query("insert into workspace_private.identity_bindings(user_id,google_subject) values ($1,$2)", [otherUserId, randomUUID()]);
    const otherClient = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false } });
    const otherSession = await otherClient.auth.signInWithPassword({ email: otherEmail, password: otherPassword });
    expect(otherSession.error).toBeNull();
    const transferred = await fetch(`${local.API_URL}/rest/v1/profiles?select=id&id=eq.${profile}`, { headers: {
      ...headers, authorization: `Bearer ${otherSession.data.session!.access_token}`, "x-founderops-workspace-permit": permit,
    } });
    expect(transferred.status).toBe(403);
    // Rejection of a foreign actor does not consume the legitimate read permit.
    expect((await fetch(`${local.API_URL}/rest/v1/profiles?select=id&id=eq.${profile}`, { headers: { ...headers, "x-founderops-workspace-permit": permit } })).status).toBe(200);
    await service.rpc("workspace_release_permit", { p_hash:await digest(permit) });
    expect((await fetch(`${local.API_URL}/rest/v1/profiles?select=id`, { headers: { ...headers, "x-founderops-workspace-permit":permit } })).status).toBe(403);
    const uploaded = await service.storage.from("fmd-tool-previews").upload(image, new Uint8Array([137,80,78,71]), { contentType:"image/png" });
    expect(uploaded.error).toBeNull();
    expect((await service.storage.from("fmd-tool-previews").download(image)).error).toBeNull();
    expect((await userClient.storage.from("fmd-tool-previews").download(image)).error).not.toBeNull();
    expect((await fetch(`${local.API_URL}/storage/v1/object/public/fmd-tool-previews/${image}`)).ok).toBe(false);
    // An explicitly selected legacy recovery restores the prior DB path, not public images.
    await database.query("update workspace_private.configuration set mode='legacy'");
    expect((await fetch(`${local.API_URL}/rest/v1/profiles?select=id`, { headers })).status).toBe(200);
    expect((await fetch(`${local.API_URL}/storage/v1/object/public/fmd-tool-previews/${image}`)).ok).toBe(false);
  } finally {
    await database.query("update workspace_private.configuration set mode='legacy'");
    await service.storage.from("fmd-tool-previews").remove([image]);
    if (otherUserId) {
      await database.query("delete from workspace_private.identity_bindings where user_id=$1", [otherUserId]);
      await database.query("delete from public.profiles where auth_user_id=$1", [otherUserId]);
      await service.auth.admin.deleteUser(otherUserId);
    }
    if (userId) {
      await database.query("delete from workspace_private.identity_bindings where user_id=$1", [userId]);
      await database.query("delete from public.profiles where id=$1", [profile]);
      await service.auth.admin.deleteUser(userId);
    }
    await database.end();
  }
}, 30_000);
