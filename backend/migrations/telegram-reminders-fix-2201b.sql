-- Fix PostgreSQL 2201B: regex repetition bounds cannot exceed 255.
-- Only replaces the installer function; keeps your current keys and settings.
-- Called by the backend with its own fixed URL and secret, never with browser-supplied credentials.
create or replace function public.install_telegram_reminder_cron(p_url text,p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
declare secret_id uuid;
begin
  if p_url is null or p_secret is null or p_url !~ '^https://[^[:space:]]+/api/telegram/reminders/run$' or length(p_secret) not between 32 and 256 or p_secret !~ '^[a-zA-Z0-9_-]+$' then raise exception 'Invalid scheduler configuration'; end if;
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

-- Make new RPC signatures visible immediately to PostgREST after the transaction commits.
notify pgrst, 'reload schema';
