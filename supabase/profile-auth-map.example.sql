-- Run these statements after enabling GitHub OAuth in Supabase.
-- GitHub login is the primary mapping key for Founder Scoreboard v2.
-- auth_user_id can stay null until the user has signed in once.

update profiles set github_login = 'MehmetVolkan', platform_role = 'ceo', org_role = 'CEO' where id = 'volkan';
update profiles set github_login = 'SebastianSchuetze', platform_role = 'founder', org_role = 'Founder' where id = 'sebastian';
update profiles set github_login = 'AnilG24', platform_role = 'founder', org_role = 'Founder' where id = 'anil';
update profiles set github_login = 'OezenG', platform_role = 'founder', org_role = 'Founder' where id = 'ozen';
update profiles set github_login = 'YoussefAdlah', platform_role = 'founder', org_role = 'Founder' where id = 'youssef';

select id, name, github_login, platform_role, org_role, auth_user_id from profiles order by name;
