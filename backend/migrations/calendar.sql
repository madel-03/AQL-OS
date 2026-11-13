-- Run once in the Supabase SQL editor. Tokens are encrypted by the backend.
create table if not exists public.calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.calendar_oauth_states (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  binder text,
  expires_at timestamptz not null
);
alter table public.calendar_connections enable row level security;
alter table public.calendar_oauth_states enable row level security;
revoke all on public.calendar_connections from anon, authenticated;
revoke all on public.calendar_oauth_states from anon, authenticated;
grant all on public.calendar_connections to service_role;
grant all on public.calendar_oauth_states to service_role;
-- Only backend service_role accesses these tables; do not add browser read policies.
