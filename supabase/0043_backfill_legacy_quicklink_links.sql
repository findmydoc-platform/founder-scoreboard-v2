insert into fmd_tools (
  id,
  name,
  category,
  kind,
  description,
  url,
  owner,
  status,
  sort_order,
  is_curated,
  preview_image_url,
  preview_image_source
) values
  ('email-signature-tool', 'E-Mail-Signatur Tool', 'tool', 'Web Tool', 'Sebastians Generator für konsistente findmydoc E-Mail-Signaturen.', 'https://mailsig.findmydoc.eu/', 'Sebastian', 'active', 10, true, null, 'none'),
  ('investor-calculator', 'Investorenrechner', 'tool', 'Finance Tool', 'Finanz-, Runway- und Liquiditätsplanungsrechner für Investorengespräche.', null, 'Volkan', 'missing_link', 20, false, null, 'none'),
  ('liquidity-planning-calculator', 'Finanz- und Liquiditätsplaner', 'tool', 'Finance Tool', 'Operativer Rechner für Cash, Runway, Szenarien und Liquiditätsplanung.', null, 'Volkan', 'missing_link', 30, false, null, 'none'),
  ('offer-calculator', 'Angebotsrechner', 'tool', 'Web Tool', 'Kalkulator für Angebotslogik, Preisannahmen und schnelle Szenariovergleiche im Klinikvertrieb.', null, 'Team', 'planned', 35, false, null, 'none'),
  ('sebastian-crawler', 'Sebastians Crawler', 'tool', 'Crawler', 'Crawler/Automation für Recherche, Datenaufbereitung oder Pipeline-Zuarbeit.', null, 'Sebastian', 'missing_link', 40, false, null, 'none'),
  ('tool-repos', 'Tool-Repositories', 'repo', 'GitHub', 'Zentrale Ablage der Repos für interne findmydoc Tools und Automationen.', 'https://github.com/findmydoc-platform/management', 'Team', 'active', 50, true, 'https://opengraph.githubassets.com/1/findmydoc-platform/management', 'og'),
  ('clinic-outreach-crm', 'Klinik-Outreach CRM', 'knowledge', 'Notion Database', 'Arbeitsliste für Klinik-Prospects, Kontaktstatus, nächste Schritte und Messe-Follow-ups.', null, 'Anil', 'planned', 55, false, null, 'none'),
  ('notion-docs-source', 'Notion Dokumente', 'knowledge', 'Notion', 'Single Source of Truth für Strategie, Prozesse, Briefings und laufende Dokumentation.', 'https://www.notion.so/Team-Workspace-31c283c73e6180cf9eedc8e0694cf2db', 'Team', 'active', 60, true, 'https://www.notion.so/images/meta/default.png', 'og'),
  ('pitchdeck-site', 'Pitch-Deck', 'asset', 'Pitch Deck', 'Aktuelles findmydoc Pitch-Deck für Investorengespräche, Founder-Abstimmung und externe Präsentationen.', 'https://pitchdeck.findmydoc.eu/', 'Youssef', 'active', 65, true, null, 'none'),
  ('brand-asset-library', 'Brand Asset Library', 'asset', 'Asset Library', 'Sammlung für Logos, Farben, Präsentationsbausteine und freigegebene Kommunikationsmaterialien.', null, 'Youssef', 'planned', 68, false, null, 'none'),
  ('google-drive-assets', 'Google Drive Assets', 'asset', 'Google Drive', 'Bilder, Videos, statische Dokumente, Präsentationen und weitere Dateien.', 'https://drive.google.com/drive/shared-drives', 'Team', 'active', 70, true, 'https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png', 'og')
on conflict (id) do nothing;

with legacy_links (id, url, is_curated, preview_image_url, preview_image_source) as (
  values
    ('email-signature-tool', 'https://mailsig.findmydoc.eu/', true, null, 'none'),
    ('tool-repos', 'https://github.com/findmydoc-platform/management', true, 'https://opengraph.githubassets.com/1/findmydoc-platform/management', 'og'),
    ('notion-docs-source', 'https://www.notion.so/Team-Workspace-31c283c73e6180cf9eedc8e0694cf2db', true, 'https://www.notion.so/images/meta/default.png', 'og'),
    ('pitchdeck-site', 'https://pitchdeck.findmydoc.eu/', true, null, 'none'),
    ('google-drive-assets', 'https://drive.google.com/drive/shared-drives', true, 'https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png', 'og')
)
update fmd_tools as tool
set
  url = coalesce(nullif(btrim(tool.url), ''), legacy_links.url),
  status = case
    when coalesce(nullif(btrim(tool.url), ''), legacy_links.url) is not null
      and tool.status in ('missing_link', 'planned')
      then 'active'
    else tool.status
  end,
  is_curated = case
    when legacy_links.is_curated
      and coalesce(nullif(btrim(tool.url), ''), legacy_links.url) is not null
      then true
    else tool.is_curated
  end,
  preview_image_url = case
    when nullif(btrim(coalesce(tool.preview_image_url, '')), '') is null
      and legacy_links.preview_image_url is not null
      then legacy_links.preview_image_url
    else tool.preview_image_url
  end,
  preview_image_source = case
    when nullif(btrim(coalesce(tool.preview_image_url, '')), '') is null
      and legacy_links.preview_image_url is not null
      then legacy_links.preview_image_source
    else tool.preview_image_source
  end
from legacy_links
where tool.id = legacy_links.id;
