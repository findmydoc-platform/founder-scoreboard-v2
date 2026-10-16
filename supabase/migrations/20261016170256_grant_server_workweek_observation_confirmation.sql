-- The publication preflight calls this RPC directly after observing Google.
-- Keep provider confirmation inaccessible to browser and anonymous sessions.
revoke all on function public.apply_google_team_workweek_observations(uuid, integer, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_google_team_workweek_observations(uuid, integer, jsonb, timestamptz) to service_role;
