import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const { navigateAfterNotificationStatusUpdate } = await loadTranspiledModule(
  "src/features/notifications/model/notification-navigation.ts",
);

test("notification navigation waits for status persistence to finish", async () => {
  const lifecycle = [];
  let finishPersistence;
  const persistenceFinished = new Promise((resolve) => {
    finishPersistence = resolve;
  });

  const navigation = navigateAfterNotificationStatusUpdate(
    async () => {
      lifecycle.push("persistence-started");
      await persistenceFinished;
      lifecycle.push("persistence-finished");
    },
    () => lifecycle.push("navigation-started"),
  );

  assert.deepEqual(lifecycle, ["persistence-started"]);

  finishPersistence();
  await navigation;

  assert.deepEqual(lifecycle, [
    "persistence-started",
    "persistence-finished",
    "navigation-started",
  ]);
});

test("task notification routes use the persistence-first navigation contract", async () => {
  const commands = await readFile(
    "src/features/planning/hooks/use-notification-commands.ts",
    "utf8",
  );

  assert.match(
    commands,
    /navigateAfterNotificationStatusUpdate\(\s*\(\) => updateNotificationStatus\(event\.id, "seen"\),\s*\(\) => router\.push\(target\.href\),\s*\)/,
  );
  assert.doesNotMatch(commands, /window\.location\.assign\(target\.href\)/);
});
