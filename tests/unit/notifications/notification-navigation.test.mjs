import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const { navigateAfterNotificationStatusUpdate } = await importTestModule(
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
