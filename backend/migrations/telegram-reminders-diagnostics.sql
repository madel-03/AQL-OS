-- Read-only: returns readiness flags only. No secret, chat ID or account data is exposed.
select 'runner_table' as check_name, to_regclass('public.telegram_reminder_runner') is not null as ok
union all select 'deliveries_table', to_regclass('public.telegram_reminder_deliveries') is not null
union all select 'reminder_settings_column', exists(select 1 from information_schema.columns where table_schema='public' and table_name='telegram_connections' and column_name='reminders_enabled')
union all select 'pg_cron_extension', exists(select 1 from pg_extension where extname='pg_cron')
union all select 'pg_net_extension', exists(select 1 from pg_extension where extname='pg_net')
union all select 'vault_extension', exists(select 1 from pg_extension where extname='supabase_vault')
union all select 'vault_create_secret_function', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='vault' and p.proname='create_secret')
union all select 'install_function', to_regprocedure('public.install_telegram_reminder_cron(text,text)') is not null
union all select 'lease_function', to_regprocedure('public.claim_telegram_reminder_run(text)') is not null
union all select 'invoke_function', to_regprocedure('public.invoke_telegram_reminders()') is not null
union all select 'service_role_can_install', coalesce(has_function_privilege('service_role',to_regprocedure('public.install_telegram_reminder_cron(text,text)'),'EXECUTE'),false)
union all select 'browser_install_blocked', not coalesce(has_function_privilege('authenticated',to_regprocedure('public.install_telegram_reminder_cron(text,text)'),'EXECUTE'),true);
