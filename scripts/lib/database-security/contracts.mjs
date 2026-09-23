export const authenticatedFunctionAllowlist = Object.freeze([
  "public.activate_administrator_access()",
  "public.administrator_access_snapshot()",
  "public.administrator_directory_snapshot()",
  "public.claim_notification_delivery(p_event_ids bigint[], p_limit integer, p_test_delivery text, p_recipient_profile_id text)",
  "public.create_private_team_workweek_version(p_effective_from date, p_windows jsonb)",
  "public.current_platform_role()",
  "public.current_authenticated_profile()",
  "public.current_profile_id()",
  "public.current_profile_has_active_administrator_access()",
  "public.end_administrator_access()",
  "public.finalize_team_workweek_publication(p_publication_id uuid)",
  "public.mutate_administrator_planning_relationship_transaction(p_operation text, p_task_id text, p_related_task_id text, p_relation_type text, p_relation_id bigint, p_note text, p_expected_updated_at timestamp with time zone, p_actor_profile_id text, p_request_ip text, p_user_agent text)",
  "public.prepare_team_workweek_publication(p_version_id uuid)",
  "public.set_administrator_eligibility(p_profile_id text, p_eligible boolean)",
  "public.update_administration_github_project_transaction(p_project_id text, p_expected_owner text, p_expected_number integer, p_github_project_owner text, p_github_project_number integer, p_request_ip text, p_user_agent text)",
  "public.update_administrator_planning_item_transaction(p_task_id text, p_expected_updated_at timestamp with time zone, p_patch jsonb, p_strategy jsonb, p_raci_assignments jsonb, p_request_ip text, p_user_agent text)",
  "public.update_administrator_planning_task_transaction(p_task_id text, p_expected_updated_at timestamp with time zone, p_task_patch jsonb, p_note_present boolean, p_note text, p_dependency_present boolean, p_dependency_note text, p_activity_messages text[], p_notifications jsonb)",
  "public.update_profile_governance_transaction(p_profile_id text, p_profile_patch jsonb, p_request_ip text, p_user_agent text)",
  "public.update_profile_technical_identity_transaction(p_profile_id text, p_profile_patch jsonb, p_request_ip text, p_user_agent text)",
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
  ["google_workspace_disconnect_operations", Object.freeze(["SELECT", "INSERT", "UPDATE"])],
  ["google_workspace_disconnect_series", Object.freeze(["SELECT", "INSERT", "UPDATE"])],
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

export const mappedOwnerTeamWorkweekReadPolicies = Object.freeze([
  ["team_workweek_versions_select_owner_private", "team_workweek_versions"],
  ["team_workweek_windows_select_owner_private", "team_workweek_windows"],
  ["team_workweek_publications_select_owner_or_published_team", "team_workweek_publications"],
  ["team_workweek_google_series_select_owner_private", "team_workweek_google_series"],
  ["team_workweek_google_series_transitions_select_owner_private", "team_workweek_google_series_transitions"],
  ["team_workweek_google_reconciliation_status_select_owner_private", "team_workweek_google_reconciliation_status"],
]);

export const mappedOwnerTeamWorkweekFunctions = Object.freeze([
  "create_private_team_workweek_version",
  "prepare_team_workweek_publication",
  "finalize_team_workweek_publication",
]);

export const planningContributorWritePolicies = Object.freeze([
  "decision_task_links_write_team",
  "task_external_comments_insert_members",
  "task_external_comments_update_members",
  "task_focus_items_write_team",
]);
