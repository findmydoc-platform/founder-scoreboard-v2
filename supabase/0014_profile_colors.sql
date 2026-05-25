alter table profiles add column if not exists profile_color text not null default '#64748b';

alter table profiles drop constraint if exists profiles_profile_color_hex;
alter table profiles add constraint profiles_profile_color_hex
  check (profile_color ~ '^#[0-9A-Fa-f]{6}$');

update profiles set profile_color = '#22c55e' where id = 'volkan' and profile_color = '#64748b';
update profiles set profile_color = '#3b82f6' where id = 'sebastian' and profile_color = '#64748b';
update profiles set profile_color = '#f59e0b' where id = 'anil' and profile_color = '#64748b';
update profiles set profile_color = '#8b5cf6' where id = 'ozen' and profile_color = '#64748b';
update profiles set profile_color = '#ec4899' where id = 'youssef' and profile_color = '#64748b';

notify pgrst, 'reload schema';
