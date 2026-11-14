-- Run once in Supabase SQL Editor. Only the backend service_role may access these tables.
create table if not exists public.telegram_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id text not null unique,
  telegram_user_id text not null,
  display_name text not null default '',
  username text not null default '',
  time_zone text not null default 'Asia/Riyadh',
  updated_at timestamptz not null default now()
);
create table if not exists public.telegram_link_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  chat_id text,
  telegram_user_id text,
  display_name text,
  username text,
  time_zone text not null default 'Asia/Riyadh'
);
create table if not exists public.telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);
alter table public.telegram_connections enable row level security;
alter table public.telegram_link_requests enable row level security;
alter table public.telegram_updates enable row level security;
revoke all on public.telegram_connections, public.telegram_link_requests, public.telegram_updates from anon, authenticated;
grant all on public.telegram_connections, public.telegram_link_requests, public.telegram_updates to service_role;

create or replace function public.confirm_telegram_link(p_user uuid, p_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare ticket public.telegram_link_requests%rowtype;
begin
  select * into ticket from public.telegram_link_requests
    where user_id = p_user and token_hash = p_token_hash for update;
  if not found or ticket.expires_at <= now() or ticket.chat_id is null then
    raise exception 'Link expired or not claimed';
  end if;
  insert into public.telegram_connections(user_id, chat_id, telegram_user_id, display_name, username, time_zone)
    values(ticket.user_id, ticket.chat_id, ticket.telegram_user_id, coalesce(ticket.display_name,''), coalesce(ticket.username,''), ticket.time_zone)
    on conflict(user_id) do update set chat_id=excluded.chat_id, telegram_user_id=excluded.telegram_user_id,
      display_name=excluded.display_name, username=excluded.username, time_zone=excluded.time_zone, updated_at=now();
  delete from public.telegram_link_requests where user_id = p_user;
end $$;
revoke all on function public.confirm_telegram_link(uuid,text) from public, anon, authenticated;
grant execute on function public.confirm_telegram_link(uuid,text) to service_role;
