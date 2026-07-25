-- Team-wide reads require a durable Auth-to-profile mapping. An authenticated
-- Supabase session alone is not membership in the findmydoc team.
alter policy audit_log_select_team
  on public.audit_log
  using (public.current_profile_id() is not null);

alter policy availability_select_team
  on public.availability
  using (public.current_profile_id() is not null);

alter policy decision_comments_select_team
  on public.decision_comments
  using (public.current_profile_id() is not null);

alter policy decision_confirmations_select_team
  on public.decision_confirmations
  using (public.current_profile_id() is not null);

alter policy decision_log_select_team
  on public.decision_log
  using (public.current_profile_id() is not null);

alter policy decision_task_links_select_team
  on public.decision_task_links
  using (public.current_profile_id() is not null);

alter policy feedback_items_select_team
  on public.feedback_items
  using (public.current_profile_id() is not null);

alter policy fmd_tools_select_team
  on public.fmd_tools
  using (public.current_profile_id() is not null);

alter policy founder_events_select_team
  on public.founder_events
  using (public.current_profile_id() is not null);

alter policy founder_sprint_scores_select_team
  on public.founder_sprint_scores
  using (public.current_profile_id() is not null);

alter policy founder_strike_state_select_team
  on public.founder_strike_state
  using (public.current_profile_id() is not null);

alter policy meeting_attendance_select_team
  on public.meeting_attendance
  using (public.current_profile_id() is not null);

alter policy meetings_select_team
  on public.meetings
  using (public.current_profile_id() is not null);

alter policy milestones_select_team
  on public.milestones
  using (public.current_profile_id() is not null);

alter policy packages_select_team
  on public.packages
  using (public.current_profile_id() is not null);

alter policy profiles_select_team
  on public.profiles
  using (public.current_profile_id() is not null);

alter policy projects_select_team
  on public.projects
  using (public.current_profile_id() is not null);

alter policy score_objections_select_team
  on public.score_objections
  using (public.current_profile_id() is not null);

alter policy sprint_commitments_select_team
  on public.sprint_commitments
  using (public.current_profile_id() is not null);

alter policy sprints_select_team
  on public.sprints
  using (public.current_profile_id() is not null);

alter policy strike_events_select_team
  on public.strike_events
  using (public.current_profile_id() is not null);

alter policy task_blockers_select_team
  on public.task_blockers
  using (public.current_profile_id() is not null);

alter policy task_comments_select_team
  on public.task_comments
  using (public.current_profile_id() is not null);

alter policy task_dependencies_select_team
  on public.task_dependencies
  using (public.current_profile_id() is not null);

alter policy task_external_comments_select_team
  on public.task_external_comments
  using (public.current_profile_id() is not null);

alter policy task_focus_items_select_team
  on public.task_focus_items
  using (public.current_profile_id() is not null);

alter policy task_links_select_team
  on public.task_links
  using (public.current_profile_id() is not null);

alter policy task_notes_select_team
  on public.task_notes
  using (public.current_profile_id() is not null);

alter policy task_relationship_edges_select_team
  on public.task_relationship_edges
  using (public.current_profile_id() is not null);

alter policy task_reviews_select_team
  on public.task_reviews
  using (public.current_profile_id() is not null);

alter policy tasks_select_team
  on public.tasks
  using (public.current_profile_id() is not null);

-- These four legacy team-write policies previously treated every authenticated
-- Supabase session as a contributor. Match the app's planning contributor gate.
alter policy decision_task_links_write_team
  on public.decision_task_links
  using (
    public.current_platform_role() = any (
      array['ceo'::text, 'founder'::text, 'deputy'::text]
    )
  )
  with check (
    public.current_platform_role() = any (
      array['ceo'::text, 'founder'::text, 'deputy'::text]
    )
  );

alter policy task_external_comments_insert_members
  on public.task_external_comments
  with check (
    public.current_platform_role() = any (
      array['ceo'::text, 'founder'::text, 'deputy'::text]
    )
  );

alter policy task_external_comments_update_members
  on public.task_external_comments
  using (
    public.current_platform_role() = any (
      array['ceo'::text, 'founder'::text, 'deputy'::text]
    )
  )
  with check (
    public.current_platform_role() = any (
      array['ceo'::text, 'founder'::text, 'deputy'::text]
    )
  );

alter policy task_focus_items_write_team
  on public.task_focus_items
  using (
    public.current_platform_role() = any (
      array['ceo'::text, 'founder'::text, 'deputy'::text]
    )
  )
  with check (
    public.current_platform_role() = any (
      array['ceo'::text, 'founder'::text, 'deputy'::text]
    )
  );

-- Profile mutations are already routed through authenticated, role-checked
-- server APIs and transactional RPCs. Direct Data API updates could otherwise
-- change authorization fields such as role or platform_role.
revoke insert, update, delete
  on table public.profiles
  from public, anon, authenticated;

alter policy profiles_update_self_or_admin
  on public.profiles
  using (false)
  with check (false);
