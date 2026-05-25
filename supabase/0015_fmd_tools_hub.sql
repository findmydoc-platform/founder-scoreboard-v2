create table if not exists fmd_tools (
  id text primary key,
  name text not null,
  category text not null check (category in ('tool', 'repo', 'knowledge', 'asset')),
  kind text not null,
  description text not null default '',
  url text,
  owner text,
  status text not null default 'missing_link' check (status in ('active', 'planned', 'missing_link', 'archived')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fmd_tools_category_status_idx on fmd_tools(category, status, sort_order);

grant select, insert, update, delete on fmd_tools to authenticated, service_role;

alter table fmd_tools enable row level security;

drop policy if exists "fmd_tools_select_team" on fmd_tools;
create policy "fmd_tools_select_team" on fmd_tools for select to authenticated
using (auth.uid() is not null);

drop policy if exists "fmd_tools_write_operational" on fmd_tools;
create policy "fmd_tools_write_operational" on fmd_tools for all to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'deputy'));

insert into fmd_tools (id, name, category, kind, description, url, owner, status, sort_order) values
  ('email-signature-tool', 'E-Mail-Signatur Tool', 'tool', 'Web Tool', 'Sebastians Generator für konsistente findmydoc E-Mail-Signaturen.', 'https://mailsig.findmydoc.eu/', 'Sebastian', 'active', 10),
  ('investor-calculator', 'Investorenrechner', 'tool', 'Finance Tool', 'Finanz-, Runway- und Liquiditätsplanungsrechner für Investorengespräche.', null, 'Volkan', 'missing_link', 20),
  ('liquidity-planning-calculator', 'Finanz- und Liquiditätsplaner', 'tool', 'Finance Tool', 'Operativer Rechner für Cash, Runway, Szenarien und Liquiditätsplanung.', null, 'Volkan', 'missing_link', 30),
  ('sebastian-crawler', 'Sebastians Crawler', 'tool', 'Crawler', 'Crawler/Automation für Recherche, Datenaufbereitung oder Pipeline-Zuarbeit.', null, 'Sebastian', 'missing_link', 40),
  ('tool-repos', 'Tool-Repositories', 'repo', 'GitHub', 'Zentrale Ablage der Repos für interne findmydoc Tools und Automationen.', null, 'Team', 'missing_link', 50),
  ('notion-docs-source', 'Notion Dokumente', 'knowledge', 'Notion', 'Single Source of Truth für Strategie, Prozesse, Briefings und laufende Dokumentation.', 'https://www.notion.so/Team-Workspace-31c283c73e6180cf9eedc8e0694cf2db', 'Team', 'active', 60),
  ('google-drive-assets', 'Google Drive Assets', 'asset', 'Google Drive', 'Bilder, Videos, statische Dokumente, Präsentationen und weitere Dateien.', 'https://drive.google.com/drive/shared-drives', 'Team', 'active', 70)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  kind = excluded.kind,
  description = excluded.description,
  url = excluded.url,
  owner = excluded.owner,
  status = excluded.status,
  sort_order = excluded.sort_order;
