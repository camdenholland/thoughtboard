-- First create your confirmed email/password user in Authentication > Users.
-- Copy that user's UUID here, then run this statement in SQL Editor.
insert into public.thoughtboard_members (user_id)
values ('REPLACE_WITH_YOUR_AUTH_USER_UUID')
on conflict (user_id) do nothing;
