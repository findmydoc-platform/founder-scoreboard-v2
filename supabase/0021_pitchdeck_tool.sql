insert into fmd_tools (id, name, category, kind, description, url, owner, status, sort_order) values
  ('pitchdeck-site', 'Pitch-Deck', 'asset', 'Pitch Deck', 'Aktuelles findmydoc Pitch-Deck für Investorengespräche, Founder-Abstimmung und externe Präsentationen.', 'https://pitchdeck.findmydoc.eu/', 'Youssef', 'active', 65)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  kind = excluded.kind,
  description = excluded.description,
  url = excluded.url,
  owner = excluded.owner,
  status = excluded.status,
  sort_order = excluded.sort_order;
