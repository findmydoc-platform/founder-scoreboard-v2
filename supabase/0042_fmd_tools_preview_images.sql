alter table fmd_tools
  add column if not exists preview_image_url text,
  add column if not exists preview_image_source text not null default 'none';

do $$
begin
  alter table fmd_tools
    add constraint fmd_tools_preview_image_source_check
    check (preview_image_source in ('none', 'og', 'manual'));
exception
  when duplicate_object then null;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fmd-tool-previews',
  'fmd-tool-previews',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

update fmd_tools
set
  preview_image_url = case id
    when 'tool-repos' then 'https://opengraph.githubassets.com/1/findmydoc-platform/management'
    when 'notion-docs-source' then 'https://www.notion.so/images/meta/default.png'
    when 'google-drive-assets' then 'https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png'
    else preview_image_url
  end,
  preview_image_source = case
    when id in ('tool-repos', 'notion-docs-source', 'google-drive-assets') then 'og'
    else preview_image_source
  end
where id in ('tool-repos', 'notion-docs-source', 'google-drive-assets');
