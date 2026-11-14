import { Router } from 'express';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { localCalendarTime } from './calendar-planning.js';
import { telegramClient, telegramConfig, telegramConfigured, telegramDay } from './telegram.js';
export function reminderErrorResponse(error) {
  const messages = {
    REMINDER_SCHEMA: 'جداول أو أعمدة التذكيرات ناقصة. شغّل telegram-reminders.sql كاملًا في مشروع Supabase نفسه المستخدم في Render.',
    REMINDER_RPC_CACHE: "دالة الجدولة لم تظهر في واجهة Supabase. شغّل telegram-reminders.sql كاملًا، ثم نفّذ: NOTIFY pgrst, 'reload schema'; وانتظر قليلًا.",
    REMINDER_PERMISSIONS: 'صلاحيات قاعدة البيانات تمنع العملية. أعد تشغيل telegram-reminders.sql كاملًا بحساب مالك المشروع، وتأكد أن الخادم يستخدم service_role.',
    REMINDER_VAULT: 'تعذّر الوصول إلى دوال Vault. فعّل Vault في Supabase ثم أعد تشغيل telegram-reminders.sql.',
    REMINDER_CRON: 'دوال Cron غير متاحة. فعّل Supabase Cron ثم أعد تشغيل telegram-reminders.sql.',
    REMINDER_NETWORK_EXTENSION: 'امتداد pg_net غير جاهز. فعّله في Supabase ثم أعد تشغيل telegram-reminders.sql.',
    REMINDER_FUNCTION: 'دالة مطلوبة للجدولة غير موجودة. شغّل telegram-reminders.sql كاملًا ثم حدّث الحالة.',
  };
  if (error?.reminderCode) {
    const stage = error.operation === 'install_cron' ? 'تعذّر تثبيت الجدولة. ' : error.operation === 'save_preferences' ? 'تعذّر حفظ الإعدادات. ' : '';
    return { error: `${stage}${messages[error.reminderCode] || 'تعذّرت عملية قاعدة البيانات الخاصة بالتذكيرات.'} [${error.reminderCode}/${error.dbCode || 'UNKNOWN'}]`, code: error.reminderCode, databaseCode: error.dbCode, stage: error.operation };
  }
  if (error?.telegramCode) return { error: error.telegramCode === 403 ? 'Telegram رفض الإرسال. افتح البوت وارفع الحظر إن وجد، ثم جرّب مجددًا.' : error.telegramCode === 401 ? 'مفتاح بوت Telegram غير مقبول. راجع TELEGRAM_BOT_TOKEN في Render.' : 'Telegram رفض طلب الإرسال؛ جرّب لاحقًا.', code: 'REMINDER_TELEGRAM', telegramCode: error.telegramCode };
  return { error: 'تعذّرت خدمة التذكيرات. حدّث الحالة، وتحقق من اتصال الخادم بقاعدة البيانات. [REMINDER_UNAVAILABLE]', code: 'REMINDER_UNAVAILABLE' };
}
export function reminderPreferences(body) {
  if (!body || typeof body.enabled !== 'boolean' || typeof body.tasks !== 'boolean' || typeof body.calendar !== 'boolean' || ![0, 5, 10, 15, 30, 60].includes(body.lead) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.taskTime || '')) throw new Error('حدّد إعدادات تذكير صحيحة.');
  return { enabled: body.enabled, tasks: body.tasks, calendar: body.calendar, lead: body.lead, taskTime: body.taskTime };
}
export function storedPreferences(row) {
  return { enabled: row.reminders_enabled === true && row.reminder_chat_id === row.chat_id, tasks: row.reminders_tasks !== false, calendar: row.reminders_calendar !== false, lead: row.reminder_lead ?? 10, taskTime: row.reminder_task_time || '09:00' };
}
export function telegramReminderCandidates(account, tasks, events, now = Date.now()) {
  const settings = storedPreferences(account); if (!settings.enabled) return [];
  const { day } = telegramDay(account.time_zone, now); const candidates = [];
  const key = value => createHash('sha256').update(`${account.chat_id}:${value}`).digest('hex');
  if (settings.tasks) {
    const when = Date.parse(localCalendarTime(day, settings.taskTime, account.time_zone));
    if (now >= when) for (const task of tasks) if (!task.completed && task.due_date === day) candidates.push({ key: key(`task:${task.id}:${day}`), kind: 'task', title: task.title, when });
  }
  if (settings.calendar) for (const event of events) {
    if (!event.id || !event.start?.dateTime || event.status === 'cancelled') continue;
    const when = Date.parse(event.start.dateTime); const trigger = when - settings.lead * 60000;
    if (Number.isFinite(when) && now >= trigger && now <= when + 10 * 60000) candidates.push({ key: key(`event:${event.id}:${when}`), kind: 'event', title: event.title, when });
  }
  return [...new Map(candidates.map(item => [item.key, item])).values()];
}
export async function runTelegramReminders({ store, readCalendar, send, now = () => Date.now() }) {
  const lease = randomUUID(); if (!await store.lease(lease)) return { busy: true };
  const started = now(); const counts = { checked: 0, delivered: 0, failed: 0, uncertain: 0 };
  try {
    await store.cleanup();
    for (const account of await store.accounts()) {
      if (now() - started > 45000) break;
      const prefs = storedPreferences(account); if (!prefs.enabled) { await store.checked(account.user_id); continue; }
      await store.checked(account.user_id); counts.checked++;
      try {
        const day = telegramDay(account.time_zone, now()); let tasks = [], events = [], sourceError = null;
        if (prefs.tasks) try { tasks = await store.tasks(account.user_id, day.day); } catch { sourceError = 'تعذّرت قراءة المهام؛ لم تُرسل تذكيرات منها.'; }
        if (prefs.calendar) try { const calendar = await readCalendar(account.user_id, new Date(now() - 10 * 60000).toISOString(), new Date(now() + 24 * 3600000).toISOString()); events = calendar.events; if (!calendar.connected) sourceError = 'تقويم Google غير مربوط؛ تذكيرات المواعيد متوقفة.'; } catch { sourceError = 'تعذّرت قراءة التقويم؛ لم تُرسل تذكيرات منه.'; }
        const candidates = telegramReminderCandidates(account, tasks, events, now()); const claimed = [];
        for (const item of candidates) { if (await store.claim(account.user_id, account.chat_id, item, now())) claimed.push(item); if (claimed.length === 10) break; }
        if (claimed.length) {
          const latest = await store.connection(account.user_id);
          if (!latest || !storedPreferences(latest).enabled || latest.chat_id !== account.chat_id || latest.reminders_updated_at !== account.reminders_updated_at) {
            for (const item of claimed) await store.finish(account.user_id, item.key, { status: 'cancelled' });
            continue;
          }
          const format = value => new Intl.DateTimeFormat('ar', { timeZone: account.time_zone, dateStyle: 'short', timeStyle: 'short' }).format(value);
          const text = ['🔔 تذكير من عقل', ...claimed.map(item => `${item.kind === 'task' ? '✓ مهمة مستحقة' : '▦ موعد'}: ${String(item.title).slice(0, 200)}\n${format(item.when)}`), account.time_zone, 'إدارة التذكيرات: الموقع ← الخدمات ← Telegram.'].join('\n\n');
          try {
            const result = await send(account.chat_id, text);
            if (!Number.isSafeInteger(result?.message_id)) throw new Error('Unconfirmed Telegram message');
            for (const item of claimed) { await store.finish(account.user_id, item.key, { status: 'delivered', message_id: String(result.message_id) }); counts.delivered++; }
          } catch (error) {
            const status = error.definitive ? 'failed' : 'uncertain';
            for (const item of claimed) { await store.finish(account.user_id, item.key, { status, retry_at: error.definitive ? new Date(now() + Math.max(60, Math.min(Number(error.retryAfter) || 60, 86400)) * 1000).toISOString() : null }); counts[status]++; }
            sourceError = error.definitive ? 'رفض Telegram الإرسال. راجع البوت وسجل الإرسال.' : 'تعذّر تأكيد الإرسال؛ لن نعيد الطلب تلقائيًا لتجنب التكرار.';
            if (error.telegramCode === 403) await store.settings(account.user_id, { reminders_enabled: false });
          }
        }
        await store.checked(account.user_id, sourceError);
      } catch { await store.checked(account.user_id, 'تعذّر إكمال فحص التذكيرات. راجع الإعدادات.'); }
    }
    return counts;
  } finally { await store.release(lease); }
}
export function createTelegramReminderRouter({ requireAuth, store, readCalendar, config = process.env, fetcher = fetch }) {
  const router = Router(); const c = telegramConfig(config); const secret = String(config.TELEGRAM_REMINDER_SECRET || '').trim();
  const configured = telegramConfigured(c) && /^[A-Za-z0-9_-]{32,256}$/.test(secret);
  const call = telegramClient(c, fetcher);
  const wrap = action => async (req, res) => { try { await action(req, res); } catch (error) { res.status(503).json(reminderErrorResponse(error)); } };
  router.post('/run', wrap(async (req, res) => {
    const given = Buffer.from(String(req.get('Authorization') || '')); const expected = Buffer.from(`Bearer ${secret}`);
    if (!configured || given.length !== expected.length || !timingSafeEqual(given, expected)) return res.sendStatus(403);
    res.json(await runTelegramReminders({ store, readCalendar, send: (chat, text) => call('sendMessage', { chat_id: chat, text, link_preview_options: { is_disabled: true } }) }));
  }));
  router.get('/', requireAuth, wrap(async (req, res) => {
    const row = await store.connection(req.user.id); if (!row) return res.status(409).json({ error: 'اربط Telegram أولًا.' });
    const heartbeat = await store.heartbeat();
    res.json({ configured, preferences: storedPreferences(row), timeZone: row.time_zone, checkedAt: row.reminders_checked_at, error: row.reminders_error, heartbeat, schedulerFresh: !!heartbeat && Date.now() - Date.parse(heartbeat) < 3 * 60000, recent: await store.recent(req.user.id) });
  }));
  router.post('/test', requireAuth, wrap(async (req, res) => {
    if (!configured) return res.status(503).json({ error: 'أكمل إعداد سر التذكيرات أولًا.' });
    const row = await store.connection(req.user.id); if (!row) return res.status(409).json({ error: 'اربط Telegram أولًا.' });
    const result = await call('sendMessage', { chat_id: row.chat_id, text: '🔔 تذكير تجريبي من عقل. الربط قادر على الإرسال. راجع حالة الجدولة في الموقع للتأكد من التذكيرات التلقائية.' });
    if (!Number.isSafeInteger(result?.message_id)) return res.status(502).json({ error: 'لم يصل تأكيد إرسال التذكير التجريبي.' });
    res.json({ accepted: true });
  }));
  router.put('/', requireAuth, wrap(async (req, res) => {
    let prefs; try { prefs = reminderPreferences(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
    const row = await store.connection(req.user.id); if (!row) return res.status(409).json({ error: 'اربط Telegram أولًا.' });
    if (prefs.enabled) {
      if (!configured) return res.status(503).json({ error: 'أضف TELEGRAM_REMINDER_SECRET في Render ثم انشر الخادم.' });
      const endpoint = new URL(c.webhook); endpoint.pathname = '/api/telegram/reminders/run'; endpoint.search = '';
      await store.install(endpoint.toString(), secret);
    }
    const saved = await store.settings(req.user.id, { reminders_enabled: prefs.enabled, reminders_tasks: prefs.tasks, reminders_calendar: prefs.calendar, reminder_lead: prefs.lead, reminder_task_time: prefs.taskTime, reminder_chat_id: row.chat_id, reminders_updated_at: new Date().toISOString(), reminders_error: null });
    if (!saved) return res.status(409).json({ error: 'تغيّر ربط الحساب. أعد المحاولة.' });
    res.json({ preferences: storedPreferences(saved) });
  }));
  return router;
}
