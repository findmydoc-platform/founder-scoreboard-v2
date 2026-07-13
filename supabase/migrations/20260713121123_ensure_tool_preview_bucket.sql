insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fmd-tool-previews',
  'fmd-tool-previews',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
