export const authenticatedFunctionAllowlist = Object.freeze([
  "public.current_platform_role()",
  "public.current_profile_id()",
  "public.current_profile_role()",
]);

export const tablePrivileges = Object.freeze([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
]);

export const highRiskAuthenticatedTablePrivileges = Object.freeze([
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
]);

export const serviceRoleOnlyTablePrivileges = Object.freeze([
  ["google_workspace_connections", Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"])],
  ["github_planning_webhook_deliveries", Object.freeze(["SELECT", "INSERT"])],
  ["github_webhook_deliveries", Object.freeze(["SELECT", "INSERT"])],
]);

export const sequencePrivileges = Object.freeze(["USAGE", "SELECT", "UPDATE"]);

export const mappedTeamReadPolicies = Object.freeze([
  ["audit_log_select_team", "audit_log"],
  ["availability_select_team", "availability"],
  ["decision_comments_select_team", "decision_comments"],
  ["decision_confirmations_select_team", "decision_confirmations"],
  ["decision_log_select_team", "decision_log"],
  ["decision_task_links_select_team", "decision_task_links"],
  ["feedback_items_select_team", "feedback_items"],
  ["fmd_tools_select_team", "fmd_tools"],
  ["founder_events_select_team", "founder_events"],
  ["founder_sprint_scores_select_team", "founder_sprint_scores"],
  ["founder_strike_state_select_team", "founder_strike_state"],
  ["meeting_attendance_select_team", "meeting_attendance"],
  ["meetings_select_team", "meetings"],
  ["planning_item_historical_links_select_team", "planning_item_historical_links"],
  ["platform_releases_select_team", "platform_releases"],
  ["profiles_select_team", "profiles"],
  ["projects_select_team", "projects"],
  ["score_objections_select_team", "score_objections"],
  ["sprint_commitments_select_team", "sprint_commitments"],
  ["sprints_select_team", "sprints"],
  ["strike_events_select_team", "strike_events"],
  ["task_blockers_select_team", "task_blockers"],
  ["task_comments_select_team", "task_comments"],
  ["task_dependencies_select_team", "task_dependencies"],
  ["task_external_comments_select_team", "task_external_comments"],
  ["task_focus_items_select_team", "task_focus_items"],
  ["task_links_select_team", "task_links"],
  ["task_notes_select_team", "task_notes"],
  ["task_relationship_edges_select_team", "task_relationship_edges"],
  ["task_reviews_select_team", "task_reviews"],
  ["tasks_select_team", "tasks"],
]);

export const planningContributorWritePolicies = Object.freeze([
  "decision_task_links_write_team",
  "task_external_comments_insert_members",
  "task_external_comments_update_members",
  "task_focus_items_write_team",
]);
