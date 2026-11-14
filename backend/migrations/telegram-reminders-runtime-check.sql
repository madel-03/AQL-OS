-- Run as the project owner in Supabase SQL Editor.
-- Uses a dummy secret only. The deliberate exception rolls back ALL installation
-- changes inside the inner block, including Vault updates and the cron job row.
-- It never invokes the worker, sends HTTP requests, or sends Telegram messages.
-- The temporary helper disappears with its database session.
create or replace function pg_temp.aql_reminder_runtime_check()
returns table(test_status text, database_code text, database_message text)
language plpgsql set search_path = '' as $$
begin
  begin
    perform public.install_telegram_reminder_cron(
      'https://aql-os.onrender.com/api/telegram/reminders/run',
      repeat('x',64)
    );
    -- Raising within this exception block undoes the successful test installation.
    raise exception using errcode='ZQ001',message='AQL_DIAGNOSTIC_ROLLBACK';
  exception
    when sqlstate 'ZQ001' then
      return query select 'OK'::text,'00000'::text,
        'Cron and Vault executed successfully. Test changes were rolled back.'::text;
    when others then
      -- No error context, parameters, existing secrets or HTTP headers are returned.
      return query select 'ERROR'::text,sqlstate::text,left(sqlerrm,500)::text;
  end;
end $$;

select * from pg_temp.aql_reminder_runtime_check();
