import assert from "node:assert/strict";
import test from "node:test";
import {
  mappedOwnerTeamWorkweekFunctions,
  mappedOwnerTeamWorkweekReadPolicies,
  serviceRoleOnlyTablePrivileges,
} from "../scripts/lib/database-security/contracts.mjs";

test("service-role-only table privileges stay centralized", () => {
  assert.deepEqual(serviceRoleOnlyTablePrivileges, [
    ["google_workspace_connections", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
    ["google_workspace_disconnect_operations", ["SELECT", "INSERT", "UPDATE"]],
    ["google_workspace_disconnect_series", ["SELECT", "INSERT", "UPDATE"]],
    ["github_planning_webhook_deliveries", ["SELECT", "INSERT"]],
    ["github_webhook_deliveries", ["SELECT", "INSERT"]],
  ]);
});

test("mapped-owner workweek contracts stay centralized and role-independent", () => {
  assert.deepEqual(mappedOwnerTeamWorkweekReadPolicies, [
    ["team_workweek_versions_select_owner_private", "team_workweek_versions"],
    ["team_workweek_windows_select_owner_private", "team_workweek_windows"],
    ["team_workweek_publications_select_owner_or_published_team", "team_workweek_publications"],
    ["team_workweek_google_series_select_owner_private", "team_workweek_google_series"],
    ["team_workweek_google_series_transitions_select_owner_private", "team_workweek_google_series_transitions"],
    ["team_workweek_google_reconciliation_status_select_owner_private", "team_workweek_google_reconciliation_status"],
  ]);
  assert.deepEqual(mappedOwnerTeamWorkweekFunctions, [
    "create_private_team_workweek_version",
    "prepare_team_workweek_publication",
    "finalize_team_workweek_publication",
  ]);
});
