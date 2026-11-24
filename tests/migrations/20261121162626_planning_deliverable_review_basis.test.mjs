import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

test("the additive Review basis keeps the old Review command and exposes the new operations only to the service", { timeout: 120_000 }, async () => {
  await resetLocalDatabaseTo("20261121135639");
  await withLocalDatabase(async db => {
    const legacy = "public.prepare_planning_review_command(text,text,text)";
    const definition = async () => (await db.query("select pg_get_functiondef($1::regprocedure) as value", [legacy])).rows[0].value;
    const original = await definition();
    await applyMigration(db, resolve("supabase/migrations/20261121162626_planning_deliverable_review_basis.sql"));
    expect(await definition()).toBe(original);
    for (const signature of [
      "public.planning_deliverable_review_basis(text,text,uuid,uuid,text,timestamptz)",
      "public.decide_planning_review_from_basis(text,timestamptz,text,uuid,uuid,text,timestamptz,text,timestamptz,text,text,text,jsonb,integer,text[],jsonb,text[],jsonb,text,text)",
    ]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const { rows: [{ allowed }] } = await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature]);
        expect(allowed).toBe(role === "service_role");
      }
    }
    const read = (deadline = "2099-01-01") => db.query(
      "select public.planning_deliverable_review_basis('target','unmapped',$1,$2,'founder',$3) result",
      [randomUUID(), randomUUID(), deadline],
    );
    await db.query("set role authenticated");
    try { await expect(read()).rejects.toMatchObject({ code: "42501" }); }
    finally { await db.query("reset role"); }
    expect((await read()).rows[0].result).toEqual({ status: "forbidden" });
  });
});
