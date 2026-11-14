export function telegramReminderStore(db) {
  const check = result => { if (result.error) throw new Error('Reminder storage unavailable'); return result.data; };
  return {
    async install(url, secret) { check(await db.rpc('install_telegram_reminder_cron', { p_url: url, p_secret: secret })); },
    async lease(token) { return check(await db.rpc('claim_telegram_reminder_run', { p_token: token })) === true; },
    async release(token) { check(await db.from('telegram_reminder_runner').update({ lease_until: new Date(0).toISOString() }).eq('name', 'main').eq('token', token)); },
    async heartbeat() { return check(await db.from('telegram_reminder_runner').select('last_started_at').eq('name', 'main').maybeSingle())?.last_started_at || null; },
    async connection(user) { return check(await db.from('telegram_connections').select('*').eq('user_id', user).maybeSingle()); },
    async accounts() { return check(await db.from('telegram_connections').select('*').eq('reminders_enabled', true).order('reminders_checked_at', { ascending: true, nullsFirst: true }).limit(10)); },
    async settings(user, fields) { return check(await db.from('telegram_connections').update(fields).eq('user_id', user).select().maybeSingle()); },
    async checked(user, error = null) { check(await db.from('telegram_connections').update({ reminders_checked_at: new Date().toISOString(), reminders_error: error }).eq('user_id', user)); },
    async tasks(user, day) { return check(await db.from('personal_tasks').select('id,title,due_date,completed').eq('user_id', user).eq('completed', false).eq('due_date', day).limit(500)); },
    async recent(user) { return check(await db.from('telegram_reminder_deliveries').select('title,kind,event_at,status,updated_at').eq('user_id', user).order('created_at', { ascending: false }).limit(15)); },
    async claim(user, chat, item, now) {
      const row = { user_id: user, chat_id: chat, occurrence_key: item.key, title: item.title.slice(0, 200), kind: item.kind, event_at: new Date(item.when).toISOString(), status: 'sending', updated_at: new Date(now).toISOString() };
      const inserted = await db.from('telegram_reminder_deliveries').insert(row).select().single();
      if (inserted.error?.code !== '23505') return check(inserted);
      const old = check(await db.from('telegram_reminder_deliveries').select('*').eq('user_id', user).eq('occurrence_key', item.key).maybeSingle());
      if (!old || old.status !== 'failed' || old.attempts >= 3 || Date.parse(old.retry_at) > now) return null;
      return check(await db.from('telegram_reminder_deliveries').update({ status: 'sending', attempts: old.attempts + 1, updated_at: new Date(now).toISOString() }).eq('user_id', user).eq('occurrence_key', item.key).eq('status', 'failed').eq('attempts', old.attempts).select().maybeSingle());
    },
    async finish(user, key, fields) { check(await db.from('telegram_reminder_deliveries').update({ ...fields, updated_at: new Date().toISOString() }).eq('user_id', user).eq('occurrence_key', key)); },
    async cleanup() {
      check(await db.from('telegram_reminder_deliveries').update({ status: 'uncertain', updated_at: new Date().toISOString() }).eq('status', 'sending').lt('updated_at', new Date(Date.now() - 4 * 60000).toISOString()));
      check(await db.from('telegram_reminder_deliveries').delete().lt('created_at', new Date(Date.now() - 30 * 86400000).toISOString()));
    },
  };
}
