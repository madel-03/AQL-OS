-- Run after telegram.sql as the project owner in Supabase SQL Editor.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

alter table public.telegram_connections
  add column if not exists reminders_enabled boolean not null default false,
  add column if not exists reminders_tasks boolean not null default true,
  add column if not exists reminders_calendar boolean not null default true,
  add column if not exists reminder_lead integer not null default 10 check (reminder_lead in (0,5,10,15,30,60)),
  add column if not exists reminder_task_time text not null default '09:00' check (reminder_task_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column if not exists reminder_chat_id text,
  add column if not exists reminders_updated_at timestamptz not null default now(),
  add column if not exists reminders_checked_at timestamptz,
  add column if not exists reminders_error text;

create table if not exists public.telegram_reminder_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_key text not null,
  chat_id text not null,
  title text not null,
  kind text not null check (kind in ('task','event')),
  event_at timestamptz not null,
  status text not null default 'sending' check (status in ('sending','delivered','failed','uncertain','cancelled')),
  attempts integer not null default 1,
  retry_at timestamptz,
  message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id, occurrence_key)
);
create index if not exists telegram_reminder_history on public.telegram_reminder_deliveries(user_id,created_at desc);
create table if not exists public.telegram_reminder_runner (
  name text primary key,
  token text not null,
  lease_until timestamptz not null,
  last_started_at timestamptz not null default now()
);
alter table public.telegram_reminder_deliveries enable row level security;
alter table public.telegram_reminder_runner enable row level security;
revoke all on public.telegram_reminder_deliveries, public.telegram_reminder_runner from anon, authenticated;
grant all on public.telegram_reminder_deliveries, public.telegram_reminder_runner to service_role;

create or replace function public.claim_telegram_reminder_run(p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare claimed text;
begin
  insert into public.telegram_reminder_runner(name,token,lease_until,last_started_at)
    values('main',p_token,now()+interval '4 minutes',now())
    on conflict(name) do update set token=excluded.token,lease_until=excluded.lease_until,last_started_at=now()
      where public.telegram_reminder_runner.lease_until < now()
    returning token into claimed;
  return claimed is not null;
end $$;
revoke all on function public.claim_telegram_reminder_run(text) from public, anon, authenticated;
grant execute on function public.claim_telegram_reminder_run(text) to service_role;

create or replace function public.invoke_telegram_reminders()
returns bigint language plpgsql security definer set search_path = '' as $$
declare endpoint text; bearer text; request_id bigint;
begin
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='aql_telegram_reminder_url' limit 1;
  select decrypted_secret into bearer from vault.decrypted_secrets where name='aql_telegram_reminder_secret' limit 1;
  if endpoint is null or bearer is null then raise exception 'Telegram reminder runner not configured'; end if;
  select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||bearer),body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;
  return request_id;
end $$;
revoke all on function public.invoke_telegram_reminders() from public, anon, authenticated;
grant execute on function public.invoke_telegram_reminders() to service_role;

-- Called by the backend with its own fixed URL and secret, never with browser-supplied credentials.
create or replace function public.install_telegram_reminder_cron(p_url text,p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
declare secret_id uuid;
begin
  if p_url !~ '^https://[^[:space:]]+/api/telegram/reminders/run$' or p_secret !~ '^[a-zA-Z0-9_-]{32,256}$' then raise exception 'Invalid scheduler configuration'; end if;
  perform pg_advisory_xact_lock(73170412);
  select id into secret_id from vault.secrets where name='aql_telegram_reminder_url' limit 1;
  if secret_id is null then perform vault.create_secret(p_url,'aql_telegram_reminder_url');
  else perform vault.update_secret(secret_id,p_url,'aql_telegram_reminder_url'); end if;
  select id into secret_id from vault.secrets where name='aql_telegram_reminder_secret' limit 1;
  if secret_id is null then perform vault.create_secret(p_secret,'aql_telegram_reminder_secret');
  else perform vault.update_secret(secret_id,p_secret,'aql_telegram_reminder_secret'); end if;
  perform cron.schedule('aql-telegram-reminders','* * * * *','select public.invoke_telegram_reminders();');
end $$;
revoke all on function public.install_telegram_reminder_cron(text,text) from public, anon, authenticated;
grant execute on function public.install_telegram_reminder_cron(text,text) to service_role;
