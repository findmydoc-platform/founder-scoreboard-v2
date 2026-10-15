-- A fully replaced future plan remains as an empty historical interval.
alter table public.team_workweek_publications
  drop constraint team_workweek_temporal_bounds;
alter table public.team_workweek_publications
  add constraint team_workweek_temporal_bounds check (
    (activation_mode = 'future_monday' or effective_at is not null)
    and (
      effective_until is null or effective_at is null or effective_until > effective_at
      or (effective_until = effective_at and activation_mode = 'future_monday'
        and status = 'published' and superseded_by_publication_id is not null
        and superseded_by_publication_id <> id)
    )
  );
