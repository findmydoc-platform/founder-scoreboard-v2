import assert from "node:assert/strict";
import test from "node:test";
import { resolveProductionSchemaConnection } from "../scripts/lib/production-schema-connection.mjs";

const validEnvironment = {
  SUPABASE_DB_HOST: "aws-0-eu-west-1.pooler.supabase.com",
  SUPABASE_DB_USER: "postgres.project-ref",
  SUPABASE_DB_PASSWORD: "secret",
};

test("production schema deploy uses the IPv4-compatible session pooler", () => {
  assert.deepEqual(resolveProductionSchemaConnection(validEnvironment), {
    host: "aws-0-eu-west-1.pooler.supabase.com",
    port: 5432,
    user: "postgres.project-ref",
    password: "secret",
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
});

test("production schema deploy rejects the IPv6-only direct database host", () => {
  assert.throws(
    () =>
      resolveProductionSchemaConnection({
        ...validEnvironment,
        SUPABASE_DB_HOST: "db.project-ref.supabase.co",
      }),
    /Supavisor session pooler/,
  );
});

test("production schema deploy fails closed when pooler credentials are incomplete", () => {
  assert.throws(
    () => resolveProductionSchemaConnection({ ...validEnvironment, SUPABASE_DB_HOST: "" }),
    /Missing SUPABASE_DB_HOST/,
  );
  assert.throws(
    () => resolveProductionSchemaConnection({ ...validEnvironment, SUPABASE_DB_USER: "" }),
    /Missing SUPABASE_DB_USER/,
  );
  assert.throws(
    () => resolveProductionSchemaConnection({ ...validEnvironment, SUPABASE_DB_PASSWORD: "" }),
    /Missing SUPABASE_DB_PASSWORD/,
  );
});
