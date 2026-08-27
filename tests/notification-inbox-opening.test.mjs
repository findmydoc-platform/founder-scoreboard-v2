import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("notification inbox opens from preloaded header data without refetching", async () => {
  const commands = await readFile(
    "src/features/planning/hooks/use-notification-commands.ts",
    "utf8",
  );
  const opener = commands.match(/const openNotificationInbox = \(\) => \{([\s\S]*?)\n  \};/);

  assert.ok(opener, "Notification inbox opener is missing.");
  assert.match(opener[1], /setShowNotifications\(true\)/);
  assert.doesNotMatch(opener[1], /setHeaderData|startTransition|requestPlanningHeaderData/);
  assert.doesNotMatch(commands, /markPlanningHeaderDataLoading/);
});
