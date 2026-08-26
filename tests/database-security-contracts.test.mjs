import assert from "node:assert/strict";
import test from "node:test";
import { serviceRoleOnlyTablePrivileges } from "../scripts/lib/database-security/contracts.mjs";

test("service-role-only table privileges stay centralized", () => {
  assert.deepEqual(serviceRoleOnlyTablePrivileges, [
    ["google_workspace_connections", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
    ["google_workspace_disconnect_operations", ["SELECT", "INSERT", "UPDATE"]],
    ["google_workspace_disconnect_series", ["SELECT", "INSERT", "UPDATE"]],
    ["github_planning_webhook_deliveries", ["SELECT", "INSERT"]],
    ["github_webhook_deliveries", ["SELECT", "INSERT"]],
  ]);
});
