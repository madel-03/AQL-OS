create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.screen_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  image text check (octet_length(image) <= 360000)
);

alter table public.screen_requests enable row level security;
revoke all on public.screen_requests from anon, authenticated;
grant select, insert, update, delete on public.screen_requests to service_role;

select cron.schedule(
  'aql-expire-screen-requests',
  '* * * * *',
  'delete from public.screen_requests where expires_at <= now();'
);
