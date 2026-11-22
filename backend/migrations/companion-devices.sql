create table if not exists public.companion_devices (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique
);
alter table public.companion_devices enable row level security;
revoke all on public.companion_devices from anon, authenticated;
grant select, insert, update, delete on public.companion_devices to service_role;
