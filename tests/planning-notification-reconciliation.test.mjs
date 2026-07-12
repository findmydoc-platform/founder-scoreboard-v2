import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const supabase = {};

function planningDataLoader(rows = {}) {
  return {
    hasCorePlanningDataError: () => false,
    loadPlanningDataRows: async () => rows,
    mapPlanningDataRows: () => ({
      marker: "planning-data",
      notificationEvents: [],
      notificationDeliveries: [],
    }),
    shouldLoad: () => false,
  };
}

test("planning data reconciliation is reused by the header load", async () => {
  let reconciliationCalls = 0;
  let headerOptions;
  const planningData = await loadTranspiledModule("src/lib/planning-data.ts", {
    "./planning-header-data": {
      emptyPlanningHeaderData: {},
      loadPlanningHeaderData: async (_supabase, options) => {
        headerOptions = options;
        return { marker: "header-data" };
      },
    },
    "./planning-data-loader": planningDataLoader(),
    "./platform": { isOperationalLeadRole: () => false },
    "./notification-resolution": {
      reconcileNotificationEvents: async () => {
        reconciliationCalls += 1;
        return { ok: true, checked: 0, resolved: 0, error: "" };
      },
    },
    "./supabase": { getServerSupabase: () => supabase },
    "./planning-data-availability": { allowsLocalPlanningFallback: () => false },
  });

  const result = await planningData.getPlanningData({}, {
    currentProfileId: "profile-1",
    platformRole: "founder",
  });

  assert.equal(reconciliationCalls, 1);
  assert.equal(headerOptions.notificationEventsReconciled, true);
  assert.equal(result.headerData.marker, "header-data");
});

test("planning header retries reconciliation when the initial attempt failed", async () => {
  let headerOptions;
  const planningData = await loadTranspiledModule("src/lib/planning-data.ts", {
    "./planning-header-data": {
      emptyPlanningHeaderData: {},
      loadPlanningHeaderData: async (_supabase, options) => {
        headerOptions = options;
        return {};
      },
    },
    "./planning-data-loader": planningDataLoader(),
    "./platform": { isOperationalLeadRole: () => false },
    "./notification-resolution": {
      reconcileNotificationEvents: async () => ({
        ok: false,
        checked: 0,
        resolved: 0,
        error: "temporary failure",
      }),
    },
    "./supabase": { getServerSupabase: () => supabase },
    "./planning-data-availability": { allowsLocalPlanningFallback: () => false },
  });

  await planningData.getPlanningData({}, {
    currentProfileId: "profile-1",
    platformRole: "founder",
  });

  assert.equal(headerOptions.notificationEventsReconciled, false);
});

test("standalone header loads reconcile unless the caller already did", async () => {
  let reconciliationCalls = 0;
  const headerData = await loadTranspiledModule("src/lib/planning-header-data.ts", {
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
