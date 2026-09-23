import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const { createAdministratorAccessSynchronizer } = await importTestModule(
  "src/features/administrator-access/model/administrator-access-synchronizer.ts",
);

test("an activation invalidates a GET that started before the command", () => {
  const synchronizer = createAdministratorAccessSynchronizer();
  const staleGet = synchronizer.beginRead();

  synchronizer.recordAuthoritativeChange();

  assert.equal(synchronizer.acceptsRead(staleGet), false);
});

test("ending access invalidates a GET that started before the command", () => {
  const synchronizer = createAdministratorAccessSynchronizer();
  const staleGet = synchronizer.beginRead();

  synchronizer.recordAuthoritativeChange();

  assert.equal(synchronizer.acceptsRead(staleGet), false);
});

test("a cross-tab update wins over older reads and only the latest following read may apply", () => {
  const synchronizer = createAdministratorAccessSynchronizer();
  const beforeBroadcast = synchronizer.beginRead();

  synchronizer.recordAuthoritativeChange();
  const firstAfterBroadcast = synchronizer.beginRead();
  const latestAfterBroadcast = synchronizer.beginRead();

  assert.equal(synchronizer.acceptsRead(beforeBroadcast), false);
  assert.equal(synchronizer.acceptsRead(firstAfterBroadcast), false);
  assert.equal(synchronizer.acceptsRead(latestAfterBroadcast), true);
});
