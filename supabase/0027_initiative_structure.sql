alter table packages add column if not exists owner_id text references profiles(id) on delete set null;
alter table packages add column if not exists status text not null default 'planned' check (status in ('planned', 'active', 'done', 'paused'));
alter table packages add column if not exists target_date date;
alter table packages add column if not exists success_criteria text not null default '';
alter table packages add column if not exists scope_constraints text not null default '';

create index if not exists packages_owner_id_idx on packages(owner_id);
create index if not exists packages_status_idx on packages(status);
create index if not exists packages_target_date_idx on packages(target_date);

update packages
set
  owner_id = case
    when id in ('GC1', 'GC2') then 'volkan'
    when id in ('GC3') then 'youssef'
    when id in ('GC4') then 'anil'
    when id in ('GC5') then 'youssef'
    else owner_id
  end,
  status = case
    when id in ('GC1', 'GC2') then 'active'
    else status
  end,
  success_criteria = case
    when success_criteria <> '' then success_criteria
    when id = 'GC1' then 'MVP, Legal-Basis und Klinik-Onboarding können ohne versteckte Vorarbeit reviewed werden.'
    when id = 'GC2' then 'Warme Klinik- und Messekontakte haben Owner, nächsten Schritt und dokumentierten Follow-up-Status.'
    when id = 'GC3' then 'Pitchdeck, Funding-Narrative und Investor-Follow-ups sind als reviewfähiges Paket vorbereitet.'
    when id = 'GC4' then 'Founder-Struktur, Governance und operative Transparenz sind für das Team nachvollziehbar dokumentiert.'
    when id = 'GC5' then 'Marketing- und Content-Arbeit ist priorisiert, briefbar und ohne medizinische Risikoaussagen nutzbar.'
    else success_criteria
  end
where owner_id is null or success_criteria = '' or status = 'planned';
