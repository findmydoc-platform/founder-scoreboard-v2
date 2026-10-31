import type pg from "pg";
import type { GoogleCalendarCapability } from "../../../src/lib/credentials/types";
import { calendarProvider } from "../../helpers/calendar-provider";
import type { WorkweekProviderWriteJournal } from "../../../src/features/team-workweek/server/team-workweek-immediate-effects";

export async function asService<T>(db: pg.Client, action: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  await db.query("set role service_role");
  try { return await action(); } finally { await db.query("reset role").catch(()=>undefined); }
}

export function localCalendar(db: pg.Client, provider: typeof fetch = (url, init) => fetch(url, init)): GoogleCalendarCapability {
  return {
    ...calendarProvider(provider),
    async mutate(binding, url, init) {
      const method = init.method!;
      const eventId = method === "POST" ? JSON.parse(String(init.body)).id : decodeURIComponent(new URL(url).pathname.split("/").at(-1)!);
      const table = binding.kind === "publication" ? "team_workweek_provider_operations" : "google_workspace_disconnect_operations";
      const owner = (await db.query(`select owner_profile_id from public.${table} where id=$1`, [binding.operationId])).rows[0].owner_profile_id;
      await asService(db, () => db.query("select public.dispatch_google_calendar_mutation($1,$2,$3,$4,$5,$6,$7)", [owner, binding.kind, binding.operationId, binding.targetId, eventId, method, Boolean(binding.replay)]));
      return provider(url, init);
    },
  };
}

export async function observeEffect(db: pg.Client, effectId: string, purpose: "publish" | "cleanup" = "publish") {
  return asService(db, async () => {
    const effect = (await db.query("select publication_id,generation from public.team_workweek_publication_effects where id=$1", [effectId])).rows[0];
    const existing = (await db.query("select id from public.team_workweek_provider_operations where publication_id=$1 and generation=$2 and purpose=$3 and state='active'", [effect.publication_id,effect.generation,purpose])).rows[0];
    const claim = existing ? {state:"claimed",id:existing.id} : (await db.query("select public.claim_team_workweek_provider_operation($1,$2,$3) as value", [effect.publication_id, effect.generation, purpose])).rows[0].value;
    if (claim.state !== "claimed") throw new Error("Observation requires an active provider claim");
    await db.query("select public.record_team_workweek_provider_write($1,$2,'observed')", [claim.id, effectId]);
    if (!existing) await db.query("select public.finish_team_workweek_provider_operation($1)", [claim.id]);
  });
}

export function localWriteJournal(db: pg.Client, operationId: string, effectId: string): WorkweekProviderWriteJournal {
  return {
    target: {kind: "publication", operationId, targetId: effectId},
    async outcome(state) {
      await asService(db, () => db.query("select public.record_team_workweek_provider_write($1,$2,$3)", [operationId, effectId, state]));
    },
  };
}

export async function confirmObservedEffect(db: pg.Client, effectId: string, generation: number, etag: string, payload: unknown) {
  await observeEffect(db, effectId);
  return asService(db, () => db.query("select public.confirm_team_workweek_effect($1,$2,$3,$4)", [effectId, generation, etag, payload]));
}

export async function confirmObservedCleanup(db: pg.Client, effectId: string, generation: number, etag: string, preserved: boolean) {
  await observeEffect(db, effectId, "cleanup");
  return asService(db, () => db.query("select public.confirm_team_workweek_planned_cleanup($1,$2,$3,$4)", [effectId, generation, etag, preserved]));
}
