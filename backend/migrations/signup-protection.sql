begin;

create schema if not exists aql_auth_private;
revoke all on schema aql_auth_private from public, anon, authenticated;
grant usage on schema aql_auth_private to supabase_auth_admin;

create table if not exists aql_auth_private.blocked_signup_domains (
  domain text primary key check (domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$')
);
revoke all on aql_auth_private.blocked_signup_domains from public, anon, authenticated;
grant select on aql_auth_private.blocked_signup_domains to supabase_auth_admin;
alter table aql_auth_private.blocked_signup_domains enable row level security;

drop policy if exists auth_admin_read_blocked_signup_domains on aql_auth_private.blocked_signup_domains;
create policy auth_admin_read_blocked_signup_domains
  on aql_auth_private.blocked_signup_domains
  for select
  to supabase_auth_admin
  using (true);

insert into aql_auth_private.blocked_signup_domains (domain)
values ('mailinator.com'), ('yopmail.com'), ('guerrillamail.com'), ('temp-mail.org'), ('10minutemail.com')
on conflict do nothing;

create or replace function public.aql_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  new_user jsonb := event -> 'user';
  signup_provider text := new_user -> 'app_metadata' ->> 'provider';
  signup_email text := lower(btrim(new_user ->> 'email'));
  raw_name jsonb := new_user -> 'user_metadata' -> 'full_name';
  display_name text := regexp_replace(new_user -> 'user_metadata' ->> 'full_name', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  email_domain text := split_part(signup_email, '@', -1);
begin
  if signup_email is null or signup_email = '' then
    return '{}'::jsonb;
  end if;

  if exists (
    select 1 from aql_auth_private.blocked_signup_domains as blocked
    where email_domain = blocked.domain or email_domain like '%.' || blocked.domain
  ) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'AQL_SIGNUP_DISPOSABLE_EMAIL'));
  end if;

  if coalesce(signup_provider, 'email') = 'email' and (
    jsonb_typeof(raw_name) is distinct from 'string'
    or char_length(display_name) not between 2 and 80
    or (new_user -> 'user_metadata' ->> 'full_name') ~ '[[:cntrl:]]'
    or regexp_replace(display_name, '[[:space:][:digit:][:punct:]٠-٩۰-۹]', '', 'g') !~ '[[:alpha:]]'
  ) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'AQL_SIGNUP_NAME_INVALID'));
  end if;

  return '{}'::jsonb;
end;
$$;

revoke execute on function public.aql_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.aql_before_user_created(jsonb) to supabase_auth_admin;

commit;
