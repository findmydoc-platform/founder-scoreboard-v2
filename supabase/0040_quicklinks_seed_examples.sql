insert into fmd_tools (id, name, category, kind, description, url, owner, status, sort_order) values
  ('offer-calculator', 'Angebotsrechner', 'tool', 'Web Tool', 'Kalkulator für Angebotslogik, Preisannahmen und schnelle Szenariovergleiche im Klinikvertrieb.', null, 'Team', 'planned', 35),
  ('tool-repos', 'Tool-Repositories', 'repo', 'GitHub', 'Zentrale Ablage der Repos für interne findmydoc Tools und Automationen.', 'https://github.com/findmydoc-platform/management', 'Team', 'active', 50),
  ('clinic-outreach-crm', 'Klinik-Outreach CRM', 'knowledge', 'Notion Database', 'Arbeitsliste für Klinik-Prospects, Kontaktstatus, nächste Schritte und Messe-Follow-ups.', null, 'Anil', 'planned', 55),
  ('brand-asset-library', 'Brand Asset Library', 'asset', 'Asset Library', 'Sammlung für Logos, Farben, Präsentationsbausteine und freigegebene Kommunikationsmaterialien.', null, 'Youssef', 'planned', 68)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  kind = excluded.kind,
  description = excluded.description,
  url = excluded.url,
  owner = excluded.owner,
  status = excluded.status,
  sort_order = excluded.sort_order;
