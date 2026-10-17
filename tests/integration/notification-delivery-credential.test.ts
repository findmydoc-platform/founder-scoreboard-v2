import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { importTestModule } from "../helpers/vitest-module.mjs";

it("notification delivery keeps real reservations, foreign claims, expiry and exact finalization isolated", async () => {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"),["status","-o","json"]);
  const local = JSON.parse(stdout);
  if (!new Set(["localhost","127.0.0.1"]).has(new URL(local.API_URL).hostname)) throw new Error("Disposable local test target required");
  const database = new pg.Client(local.DB_URL);
  await database.connect();
  const originalFetch = globalThis.fetch;
  const marker = `synthetic-delivery-${randomUUID()}`;
  const ids: number[] = [];
  const sends: unknown[] = [];
  try {
    for (const [name,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:local.API_URL,SUPABASE_URL:local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY:local.ANON_KEY,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_ANON_KEY:local.ANON_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,REQUIRE_SUPABASE_AUTH:"true",
      FOUNDEROPS_DELIVERY_SECRET:"synthetic-delivery-secret",GOOGLE_CHAT_DELIVERY_ENABLED:"true",GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL:"",GOOGLE_CHAT_PRIVATE_KEY:"",
      GOOGLE_CHAT_WEBHOOK_URL:"https://chat.googleapis.com/v1/spaces/synthetic/messages?key=synthetic-key&token=synthetic-token",APP_URL:"https://app.example.test"})) vi.stubEnv(name,value);
    vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
      const request = new Request(input,init),url = new URL(request.url);
      if (url.origin === "https://chat.googleapis.com") {sends.push(await request.json());return Response.json({name:"spaces/synthetic/messages/synthetic"});}
      if (url.origin !== new URL(local.API_URL).origin) throw new Error("Unexpected external provider in notification parity test");
      return originalFetch(request);
    });
    for(let n=0;n<5;n++) {
      const inserted = await database.query("insert into public.notification_events(type,entity_type,entity_id,title,status) values ('planning_item.rejected','task',$1,'Synthetic notification','pending') returning id",[marker]);
      ids.push(Number(inserted.rows[0].id));
    }
    const {authorizeCredentialAction} = await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
    const route = await importTestModule("src/app/api/notifications/deliver/route.ts",{"server-only":{}});
    const request = (eventIds:number[]) => new NextRequest("https://app.example.test/api/notifications/deliver",{method:"POST",headers:{"x-founderops-delivery-secret":"synthetic-delivery-secret","content-type":"application/json"},body:JSON.stringify({eventIds})});
    const sent = await route.POST(request([ids[0]]));
    expect(sent.status).toBe(200);expect(await sent.json()).toMatchObject({sent:1});expect(sends).toHaveLength(1);
    const repeated = await route.POST(request([ids[0]]));expect(repeated.status).toBe(200);expect(await repeated.json()).toMatchObject({sent:0});expect(sends).toHaveLength(1);
    async function reserve(id:number) {
      const permission = await authorizeCredentialAction({credential:{kind:"notification-delivery-request",request:request([id])},action:"notifications.delivery.run",selection:{eventIds:[id]}});
      if(!permission.ok || !permission.delivery)throw new Error("Expected delivery capability");
      const result = await permission.delivery.reserve();if(!result.ok || !result.claim)throw new Error("Expected exact reservation");return result.claim;
    }
    const foreign = await reserve(ids[1]);
    await database.query("update public.notification_delivery_claims set claim_token=$1 where event_id=$2",[randomUUID(),ids[1]]);
    await expect(foreign.load()).rejects.toMatchObject({status:409});expect(sends).toHaveLength(1);
    const expired = await reserve(ids[2]);
    await database.query("update public.notification_delivery_claims set claimed_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' where event_id=$1",[ids[2]]);
    await expect(expired.load()).rejects.toMatchObject({status:409});expect(sends).toHaveLength(1);
    const exact = await reserve(ids[3]);
    const other = await reserve(ids[4]);
    await exact.load();await exact.finalize();
    expect((await database.query("select event_id from public.notification_delivery_claims where event_id=any($1) order by event_id",[[ids[3],ids[4]]])).rows.map(row=>Number(row.event_id))).toEqual([ids[4]]);
    await expect(exact.finalize()).rejects.toMatchObject({status:409});await other.release();
    expect((await database.query("select event_id,status from public.notification_deliveries where event_id=any($1)",[ids])).rows).toEqual([{event_id:String(ids[0]),status:"sent"}]);
  } finally {
    vi.unstubAllGlobals();vi.unstubAllEnvs();
    if(ids.length) {await database.query("delete from public.notification_deliveries where event_id=any($1)",[ids]);await database.query("delete from public.notification_delivery_claims where event_id=any($1)",[ids]);await database.query("delete from public.notification_events where id=any($1)",[ids]);}
    await database.end();
  }
},30000);
