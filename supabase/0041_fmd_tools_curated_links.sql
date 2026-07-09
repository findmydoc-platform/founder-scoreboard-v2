alter table fmd_tools
  add column if not exists is_curated boolean not null default false;

update fmd_tools
set is_curated = true
where id in (
  'email-signature-tool',
  'tool-repos',
  'notion-docs-source',
  'pitchdeck-site',
  'google-drive-assets'
);
