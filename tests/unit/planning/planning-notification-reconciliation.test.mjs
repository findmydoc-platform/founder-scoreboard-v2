import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

test("standalone header loads reconcile unless the caller already did", async () => {
  let reconciliationCalls = 0;
  const headerData = await importTestModule("src/lib/planning-header-data.ts", {
    "@/lib/notification-resolution": {
      reconcileNotificationEvents: async () => {
        reconciliationCalls += 1;
        return { ok: true, checked: 0, resolved: 0, error: "" };
      },
    },
    "@/lib/platform": { isOperationalLeadRole: () => false },
  });
  const notificationQuery = {
    select() { return notificationQuery; },
    eq() { return notificationQuery; },
    is() { return notificationQuery; },
    order() { return notificationQuery; },
    limit() { return notificationQuery; },
    then(resolve) { return Promise.resolve(resolve({ data: [], count: 0, error: null })); },
  };
  const database = {
    from(table) {
      assert.equal(table, "notification_events");
      return notificationQuery;
    },
  };

  await headerData.loadPlanningHeaderData(database, {
    currentProfileId: "profile-1",
    platformRole: "founder",
    slots: ["notifications"],
  });
  await headerData.loadPlanningHeaderData(database, {
    currentProfileId: "profile-1",
    platformRole: "founder",
    notificationEventsReconciled: true,
    slots: ["notifications"],
  });

  assert.equal(reconciliationCalls, 1);
});
