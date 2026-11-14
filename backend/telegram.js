import { Router } from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { localCalendarTime } from './calendar-planning.js';
const hash = value => createHash('sha256').update(value).digest('hex');
export function telegramConfig(env = process.env) {
  const get = key => String(env[key] || '').trim();
  return { token: get('TELEGRAM_BOT_TOKEN'), secret: get('TELEGRAM_WEBHOOK_SECRET'), username: get('TELEGRAM_BOT_USERNAME') || 'aql_jarvis_assistant_bot', webhook: get('TELEGRAM_WEBHOOK_URL'), app: get('APP_URL') };
}
export const telegramConfigured = c => /^\d+:[A-Za-z0-9_-]{20,}$/.test(c.token) && /^[A-Za-z0-9_-]{32,256}$/.test(c.secret) && /^[A-Za-z0-9_]{5,32}$/.test(c.username) && /^https:\/\/[^\s]+\/api\/telegram\/webhook$/.test(c.webhook) && /^https:\/\/[^\s]+/.test(c.app);
export function telegramClient(config, fetcher = fetch) {
  return async (method, body = {}) => {
    let response;
    try { response = await fetcher(`https://api.telegram.org/bot${config.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('Telegram network unavailable'); }
    const value = await response.json().catch(() => ({}));
    if (!response.ok || value.ok !== true) throw Object.assign(new Error('Telegram request failed'), { definitive: value.ok === false, telegramCode: value.error_code || response.status, retryAfter: value.parameters?.retry_after });
    return value.result;
  };
}
export async function registerTelegramWebhook(env = process.env, fetcher = fetch) {
  const c = telegramConfig(env); if (!telegramConfigured(c)) return false;
  const call = telegramClient(c, fetcher); const bot = await call('getMe');
  if (bot.username?.toLowerCase() !== c.username.toLowerCase()) throw new Error('Telegram bot username mismatch');
  await call('setWebhook', { url: c.webhook, secret_token: c.secret, allowed_updates: ['message'], max_connections: 5 });
  await call('setMyCommands', { commands: [{ command: 'today', description: 'مواعيدك ومهامك اليوم' }, { command: 'tasks', description: 'المهام المتبقية' }, { command: 'help', description: 'المساعدة' }, { command: 'unlink', description: 'فصل الربط بحساب عقل' }] });
  return true;
}
export function telegramDay(zone, now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now)).map(item => [item.type, item.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const next = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return { day, from: localCalendarTime(day, '00:00', zone), until: localCalendarTime(next, '00:00', zone) };
}
export function createTelegramRouter({ requireAuth, store, readCalendar, config = process.env, fetcher = fetch }) {
  const router = Router(); const c = telegramConfig(config); const configured = telegramConfigured(c); const call = telegramClient(c, fetcher);
  const run = action => async (req, res, next) => { try { await action(req, res); } catch { next(new Error('Telegram unavailable')); } };
  const ready = (req, res, next) => configured ? next() : res.status(503).json({ error: 'أضف إعدادات Telegram في Render ثم انشر الخادم.' });
  router.get('/status', requireAuth, run(async (req, res) => {
    if (!configured) return res.json({ configured: false, username: c.username, connected: false });
    const connection = await store.connection(req.user.id); const pending = await store.pending(req.user.id);
    res.json({ configured, username: c.username, connected: !!connection, connection: connection ? { displayName: connection.display_name, username: connection.username, timeZone: connection.time_zone } : null, pending: pending ? { expiresAt: pending.expires_at, claimed: !!pending.chat_id, displayName: pending.display_name, username: pending.username } : null });
  }));
  router.post('/link', requireAuth, ready, run(async (req, res) => {
    const zone = req.body?.timeZone || 'Asia/Riyadh'; if (typeof zone !== 'string' || zone.length > 100) return res.sendStatus(400);
    try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); } catch { return res.status(400).json({ error: 'منطقة زمنية غير صالحة.' }); }
    const code = randomBytes(24).toString('base64url'); const expires = new Date(Date.now() + 600000).toISOString();
    await store.link(req.user.id, hash(code), expires, zone);
    res.json({ url: `https://t.me/${c.username}?start=${code}`, expiresAt: expires });
  }));
  router.post('/confirm', requireAuth, ready, run(async (req, res) => {
    const pending = await store.pending(req.user.id);
    if (!pending?.chat_id) return res.status(409).json({ error: 'افتح رابط البوت واضغط Start، ثم أعد المحاولة قبل انتهاء الرابط.' });
    await store.confirm(req.user.id, pending.token_hash); res.json({ connected: true });
  }));
  router.delete('/pending', requireAuth, ready, run(async (req, res) => { await store.cancel(req.user.id); res.json({ cancelled: true }); }));
  router.delete('/connection', requireAuth, ready, run(async (req, res) => { await store.disconnect(req.user.id); res.json({ disconnected: true }); }));
  router.post('/webhook', async (req, res) => {
    const given = Buffer.from(String(req.get('X-Telegram-Bot-Api-Secret-Token') || '')); const expected = Buffer.from(c.secret);
    if (!configured || given.length !== expected.length || !timingSafeEqual(given, expected)) return res.sendStatus(403);
    const update = req.body;
    if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) return res.sendStatus(400);
    const message = update.message;
    if (!message || message.chat?.type !== 'private' || !Number.isSafeInteger(message.chat.id) || message.chat.id <= 0 || message.chat.id !== message.from?.id || message.from?.is_bot || typeof message.text !== 'string') return res.json({ ok: true });
    const chat = String(message.chat.id); const text = message.text.trim().slice(0, 2000); const command = text.split(/\s/)[0].split('@')[0].toLowerCase();
    const send = body => call('sendMessage', { chat_id: chat, text: body.slice(0, 3900), link_preview_options: { is_disabled: true } });
    try {
      if (!await store.claimUpdate(update.update_id)) return res.json({ ok: true });
      if (command === '/start' && /^[A-Za-z0-9_-]{32}$/.test(text.split(/\s+/)[1] || '')) {
        const claim = await store.claim(hash(text.split(/\s+/)[1]), { chat_id: chat, telegram_user_id: String(message.from.id), display_name: String(message.from.first_name || '').slice(0, 100), username: String(message.from.username || '').slice(0, 50) });
        await send(claim ? 'استلمت طلب الربط. ارجع إلى عقل وافحص اسم حساب Telegram، ثم اضغط «تأكيد الربط». لا أستطيع قراءة بياناتك قبل تأكيدك من الموقع.' : 'رابط الربط منتهٍ أو مستخدم. أنشئ رابطًا جديدًا من عقل.');
      } else {
        const connection = await store.byChat(chat);
        if (!connection || connection.telegram_user_id !== String(message.from.id)) await send('اربط حسابك أولًا من عقل ← الخدمات ← Telegram.');
        else if (command === '/unlink') { await store.disconnect(connection.user_id); await send('فصلت هذا الحساب عن عقل. لن أعرض بياناته هنا حتى تعيد الربط.'); }
        else if (command === '/tasks' || command === '/today' || /^(وش عندي اليوم|ايش عندي اليوم|مهامي|المهام)$/.test(text)) {
          const today = command === '/today' || text.includes('اليوم'); const window = telegramDay(connection.time_zone);
          let tasks; try { tasks = await store.tasks(connection.user_id); } catch { tasks = null; }
          const selected = tasks?.filter(task => !today || (task.due_date && task.due_date <= window.day));
          const lines = [today ? `يومك — ${window.day} (${connection.time_zone})` : 'مهامك المتبقية'];
          if (today) {
            try {
              const calendar = await readCalendar(connection.user_id, window.from, window.until);
              if (!calendar.connected) lines.push('تقويم Google غير مربوط.');
              else { lines.push(`المواعيد: ${calendar.events.length}`); for (const event of calendar.events.slice(0, 8)) lines.push(`• ${event.start.date ? 'طوال اليوم' : new Intl.DateTimeFormat('ar', { timeZone: connection.time_zone, timeStyle: 'short' }).format(new Date(event.start.dateTime))} — ${String(event.title).slice(0, 200)}`); if (calendar.events.length > 8) lines.push('باقي المواعيد في الموقع.'); }
            } catch { lines.push('تعذّرت قراءة التقويم؛ لا أقدر أؤكد المواعيد الآن.'); }
          }
          if (tasks === null) lines.push('تعذّرت قراءة المهام الآن.');
          else { lines.push(today ? 'مهام مستحقة اليوم أو متأخرة:' : 'المهام:'); if (!selected.length) lines.push('لا توجد مهام في هذا العرض.'); for (const task of selected.slice(0, 12)) lines.push(`• ${String(task.title).slice(0, 160)}${task.due_date ? ` — ${task.due_date}` : ''}`); if (selected.length > 12 || tasks.length >= 100) lines.push('توجد مهام أخرى؛ افتح القائمة الكاملة في عقل.'); }
          await send(lines.join('\n'));
        } else await send('أنا جارفس المرتبط بعقل.\n/today — مواعيدك ومهامك اليوم\n/tasks — مهامك المتبقية\n/unlink — فصل الربط\n\nإضافة المواعيد والمهام وتأكيدها تتم من الموقع. لتفعيل تذكيرات Telegram: الموقع ← الخدمات ← Telegram ← التذكيرات.');
      }
      res.json({ ok: true });
    } catch {
      // Never return provider URLs/tokens. A claimed update is not replayed after an uncertain send.
      res.status(503).json({ ok: false });
    }
  });
  router.use((error, req, res, next) => { void error; void next; res.status(503).json({ error: 'تعذّر ربط Telegram. تأكد من الإعدادات وتشغيل ملف telegram.sql.' }); });
  return router;
}
