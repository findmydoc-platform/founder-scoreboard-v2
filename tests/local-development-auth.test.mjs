import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const {
  isLoopbackRequestHost,
  isLoopbackSupabaseUrl,
  isLocalLoginRequestAllowed,
  isLocalLoginSimulationEnabled,
} = await loadTranspiledModule("src/lib/local-development-auth.ts");

test("local login accepts only explicit development loopback configuration", () => {
  const environment = {
    NODE_ENV: "development",
    ENABLE_LOCAL_LOGIN: "true",
    NEXT_PUBLIC_ENABLE_LOCAL_LOGIN: "true",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  };

  assert.equal(isLocalLoginSimulationEnabled(environment), true);
  assert.equal(isLocalLoginRequestAllowed("localhost:3000", environment), true);
  assert.equal(isLocalLoginRequestAllowed("127.0.0.1:3002", environment), true);
});

test("local login fails closed for production, remote hosts, remote Supabase, and missing flags", () => {
  const local = {
    NODE_ENV: "development",
    ENABLE_LOCAL_LOGIN: "true",
    NEXT_PUBLIC_ENABLE_LOCAL_LOGIN: "true",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  };

  assert.equal(isLocalLoginRequestAllowed("example.com", local), false);
  assert.equal(isLocalLoginRequestAllowed("localhost:3000", { ...local, NODE_ENV: "production" }), false);
  assert.equal(isLocalLoginRequestAllowed("localhost:3000", { ...local, ENABLE_LOCAL_LOGIN: "false" }), false);
  assert.equal(isLocalLoginRequestAllowed("localhost:3000", { ...local, NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" }), false);
  assert.equal(isLocalLoginSimulationEnabled({ ...local, NEXT_PUBLIC_ENABLE_LOCAL_LOGIN: "false" }), false);
});

test("loopback parsing rejects lookalike and malformed hosts", () => {
  assert.equal(isLoopbackRequestHost("localhost:3000"), true);
  assert.equal(isLoopbackRequestHost("[::1]:3000"), true);
  assert.equal(isLoopbackRequestHost("localhost.example.com:3000"), false);
  assert.equal(isLoopbackRequestHost("bad host"), false);
  assert.equal(isLoopbackSupabaseUrl("http://127.0.0.1:54321"), true);
  assert.equal(isLoopbackSupabaseUrl("https://127.0.0.1.example.com"), false);
});
