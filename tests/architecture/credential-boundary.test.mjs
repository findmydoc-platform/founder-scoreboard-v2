import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyCredentialBoundary } from "../../scripts/lib/credential-boundary.mjs";

function fixture(files, run, resourceEdges = []) {
  const root = mkdtempSync(path.join(tmpdir(), "credential-boundary-"));
  try {
    for (const [name, content] of Object.entries({
      "src/lib/credentials/index.ts": "export function authorizeCredentialAction() {}",
      "src/lib/credentials/internal/provider.ts": "export const secret = true;",
      ...files,
    })) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), content);
    }
    run(verifyCredentialBoundary({ root, resourceEdges }));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("accepts public seam, type imports and internal adapters", () => {
  fixture({
    "src/route.ts": "import { verify } from '@/lib/credentials'; import type { secret } from './lib/credentials/internal/provider'; verify();",
    "src/lib/credentials/internal/adapter.ts": "export { secret } from './provider';",
  }, failures => assert.deepEqual(failures, []));
});

test("rejects resolved alias access to internal adapters", () => {
  fixture({ "src/route.ts": "import * as provider from '@/lib/credentials/internal/provider';" },
    failures => assert.match(failures.join("\n"), /internal credential adapter/));
});

for (const [name, code] of Object.entries({
  relative: "import { secret } from './lib/credentials/internal/provider';",
  reexport: "export * from './lib/credentials/internal/provider';",
  dynamic: "import('./lib/credentials/internal/provider');",
  commonjs: "const provider = require('./lib/credentials/internal/provider');",
  importEquals: "import provider = require('./lib/credentials/internal/provider');",
  unresolved: "const target = './lib/credentials/internal/provider'; import(target);",
})) {
  test(`rejects ${name} bypass`, () => fixture({ "src/route.ts": code }, failures => assert.ok(failures.length)));
}

test("rejects indirect re-export through a new library helper", () => {
  fixture({
    "src/route.ts": "import { secret } from './helper';",
    "src/helper.ts": "export * from './lib/credentials/internal/provider';",
  }, failures => assert.match(failures.join("\n"), /src\/helper.ts.*internal credential adapter/));
});

test("resource allowance is an exact resolved edge, never a directory exemption", () => {
  fixture({
    "src/legacy.ts": "import 'node:net';",
    "src/new.ts": "import 'node:net';",
  }, failures => {
    assert.equal(failures.length, 1);
    assert.match(failures[0], /src\/new.ts/);
  }, [{ from: "src/legacy.ts", to: "node:net" }]);
});

test("rejects direct authentication network access outside an adapter", () => {
  fixture({ "src/route.ts": "const transport = globalThis.fetch; transport('/auth/v1/token');" },
    failures => assert.match(failures.join("\n"), /network transport/));
});

test("resolves additional configured aliases before applying ownership rules", () => {
  fixture({
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "private-credentials/*": ["src/lib/credentials/internal/*"] } } }),
    "src/route.ts": "export * from 'private-credentials/provider';",
  }, failures => assert.match(failures.join("\n"), /internal credential adapter/));
});

test("accepts explicitly type-only re-exports of protected modules", () => {
  fixture({ "src/route.ts": "export { type Client } from '@supabase/supabase-js';" },
    failures => assert.deepEqual(failures, []));
});

test("an exact resource adapter edge does not admit another compatibility wrapper", () => {
  fixture({
    "src/legacy.ts": "export * from './lib/credentials/internal/provider';",
    "src/new.ts": "export * from './lib/credentials/internal/provider';",
  }, failures => {
    assert.equal(failures.length, 1);
    assert.match(failures[0], /src\/new.ts.*internal credential adapter/);
  }, [{ from: "src/legacy.ts", to: "src/lib/credentials/internal/provider.ts" }]);
});

test("browser callers may use the public transport without exposing its private adapter", () => {
  fixture({
    "src/browser.ts": "import { createBrowserSessionAdapter } from '@/lib/credentials/browser'; createBrowserSessionAdapter();",
    "src/lib/credentials/browser.ts": "export { createBrowserSessionAdapter } from './internal/browser-session';",
    "src/lib/credentials/internal/browser-session.ts": "export const createBrowserSessionAdapter = () => fetch('/api/auth/session');",
  }, failures => assert.deepEqual(failures, []));
});

test("the browser transport cannot re-export or acquire a server credential adapter", () => {
  fixture({
    "src/lib/credentials/browser.ts": "export * from './internal/provider';",
  }, failures => assert.match(failures.join("\n"), /browser transport cannot acquire server/));
});

test("the private browser adapter cannot restore an independent Auth SDK", () => {
  fixture({ "src/lib/credentials/internal/browser-session.ts": "import { createClient } from '@supabase/supabase-js';" },
    failures => assert.match(failures.join("\n"), /browser transport cannot acquire authentication SDKs/));
});


for (const [name, code] of Object.entries({
  aliasedCommonJS: "const load = require; load('./lib/credentials/internal/provider');",
  computedCommonJS: "module['require']('./lib/credentials/internal/provider');",
  createdCommonJS: "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load('./lib/credentials/internal/provider');",
  runtimeConstructor: "const load = Function('specifier', 'return import(specifier)'); load('./lib/credentials/internal/provider');",
  computedTransport: "const send = globalThis['fetch']; send('/auth/v1/token');",
})) {
  test(`rejects ${name} ownership bypass`, () => fixture({ "src/route.ts": code }, failures => assert.ok(failures.length)));
}

test("the public server entry cannot re-export a raw private client", () => {
  fixture({ "src/lib/credentials/index.ts": "export { secret } from './internal/provider';" }, failures => assert.ok(failures.length));
});

test("the internal runtime file loader cannot select another built-in", () => {
  fixture({ "src/lib/credentials/internal/github-installation.ts": "process.getBuiltinModule('node:http').request('https://example.test');" }, failures => assert.ok(failures.length));
});


test("a client cannot reach a server entry through a library wrapper", () => fixture({
  "src/client.ts": "'use client'; import { authorizeCredentialAction } from './wrapper';",
  "src/wrapper.ts": "export { authorizeCredentialAction } from './lib/credentials';",
}, failures => assert.match(failures.join("\n"), /client dependency graph/)));
test("a client cannot hide a server adapter behind a dynamic public entry", () => fixture({
  "src/client.ts": "'use client'; import('./lib/credentials');",
}, failures => assert.match(failures.join("\n"), /client dependency graph/)));
test("only the private installation adapter can read a fixed filesystem built-in", () => fixture({
  "src/lib/credentials/internal/github-installation.ts": "const { readFile } = process.getBuiltinModule('node:fs').promises;",
}, failures => assert.deepEqual(failures, [])));
