import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const supabase = {};

function planningDataLoader(rows = {}, options = {}) {
  return {
    hasCorePlanningDataError: () => false,
    loadPlanningDataRows: async () => {
      options.onLoadRows?.();
      return rows;
    },
    mapPlanningDataRows: () => options.data || ({
      marker: "planning-data",
      notificationEvents: [],
      notificationDeliveries: [],
    }),
    shouldLoad: (_scope, key) => options.loadedKeys?.includes(key) || false,
  };
}

test("deferred planning data skips SSR reconciliation when notification events are excluded", async () => {
  let reconciliationCalls = 0;
  let headerCalls = 0;
  const planningData = await loadTranspiledModule("src/lib/planning-data.ts", {
    "./planning-header-data": {
      emptyPlanningHeaderData: { marker: "empty-header-data" },
      loadPlanningHeaderData: async () => {
        headerCalls += 1;
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

  const result = await planningData.getPlanningData({ notificationEvents: false }, {
    currentProfileId: "profile-1",
    platformRole: "founder",
  }, { headerData: "deferred" });

  assert.equal(reconciliationCalls, 0);
  assert.equal(headerCalls, 0);
  assert.equal(result.headerData.marker, "empty-header-data");
});

test("deferred notification data reconciles exactly once before loading resolved rows", async () => {
  const callOrder = [];
  let notificationsResolved = false;
  const planningData = await loadTranspiledModule("src/lib/planning-data.ts", {
    "./planning-header-data": {
      emptyPlanningHeaderData: {},
      loadPlanningHeaderData: async () => {
        assert.fail("deferred planning data must not load header data during SSR");
      },
    },
    "./planning-data-loader": planningDataLoader({}, {
      loadedKeys: ["notificationEvents"],
      onLoadRows: () => {
        callOrder.push("rows");
        assert.equal(notificationsResolved, true);
      },
      data: {
        marker: "planning-data",
        notificationEvents: [{ id: 1, recipientProfileId: "profile-1", status: "resolved" }],
        notificationDeliveries: [],
      },
    }),
    "./platform": { isOperationalLeadRole: () => false },
    "./notification-resolution": {
      reconcileNotificationEvents: async () => {
        callOrder.push("reconcile");
        notificationsResolved = true;
        return { ok: true, checked: 1, resolved: 1, error: "" };
      },
    },
    "./supabase": { getServerSupabase: () => supabase },
    "./planning-data-availability": { allowsLocalPlanningFallback: () => false },
  });

  const result = await planningData.getPlanningData({ notificationEvents: true }, {
    currentProfileId: "profile-1",
    platformRole: "founder",
  }, { headerData: "deferred" });

  assert.deepEqual(callOrder, ["reconcile", "rows"]);
  assert.equal(result.data.notificationEvents[0].status, "resolved");
});

test("planning data reconciliation is reused by the header load", async () => {
  let reconciliationCalls = 0;
  let headerOptions;
  const callOrder = [];
  const planningData = await loadTranspiledModule("src/lib/planning-data.ts", {
    "./planning-header-data": {
      emptyPlanningHeaderData: {},
      loadPlanningHeaderData: async (_supabase, options) => {
        callOrder.push("header");
        headerOptions = options;
        return { marker: "header-data" };
      },
    },
    "./planning-data-loader": planningDataLoader({}, {
      onLoadRows: () => callOrder.push("rows"),
    }),
    "./platform": { isOperationalLeadRole: () => false },
    "./notification-resolution": {
      reconcileNotificationEvents: async () => {
        callOrder.push("reconcile");
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
  assert.deepEqual(callOrder, ["reconcile", "rows", "header"]);
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
