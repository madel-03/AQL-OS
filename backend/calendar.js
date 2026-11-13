import { Router } from 'express';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const scope = 'https://www.googleapis.com/auth/calendar.events.owned';
export function calendarCrypto(key) {
  const bytes = Buffer.from(key || '', 'base64');
  if (bytes.length !== 32) throw new Error('CALENDAR_TOKEN_KEY must be a 32-byte base64 key');
  return {
    seal(value) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', bytes, iv); const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]); return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.'); },
    open(value) { const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64url')); const decipher = createDecipheriv('aes-256-gcm', bytes, iv); decipher.setAuthTag(tag); return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()])); },
  };
}
export function calendarEvent(value) {
  if (typeof value?.title !== 'string' || !value.title.trim() || value.title.length > 200) throw new Error('عنوان الموعد مطلوب (حتى ٢٠٠ حرف).');
  const valid = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(date) && Number.isFinite(Date.parse(date));
  if (!valid(value.start) || !valid(value.end) || Date.parse(value.end) <= Date.parse(value.start) || Date.parse(value.end) - Date.parse(value.start) > 7 * 86400000) throw new Error('حدّد بداية ونهاية صحيحتين للموعد (بحد أقصى ٧ أيام).');
  if (!/^[0-9a-f]{32}$/.test(value.requestId || '')) throw new Error('Invalid event request ID');
  return { id: `a${value.requestId}`, summary: value.title.trim(), description: typeof value.description === 'string' ? value.description.slice(0, 2000) : '', start: { dateTime: new Date(value.start).toISOString() }, end: { dateTime: new Date(value.end).toISOString() } };
}

export function createCalendarRouter({ requireAuth, store, config = process.env, fetcher = fetch }) {
  const router = Router();
  const configured = () => !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REDIRECT_URI && config.APP_URL && config.CALENDAR_TOKEN_KEY && Buffer.from(config.CALENDAR_TOKEN_KEY, 'base64').length === 32);
  const vault = () => calendarCrypto(config.CALENDAR_TOKEN_KEY);
  const jsonFetch = async (url, options = {}) => {
    const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(20000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error('Google Calendar request failed'), { googleStatus: response.status, googleCode: data.error });
    return data;
  };
  const tokenRequest = body => jsonFetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, ...body }) });
  async function access(user) {
    const saved = await store.get(user); if (!saved) throw Object.assign(new Error('اربط Google Calendar أولًا.'), { status: 409 });
    const tokens = vault().open(saved);
    if (tokens.expires > Date.now() + 60000) return tokens.access_token;
    if (!tokens.refresh_token) throw Object.assign(new Error('أعد ربط تقويم Google.'), { status: 409 });
    const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    const updated = { ...tokens, ...fresh, expires: Date.now() + Number(fresh.expires_in || 3600) * 1000 };
    await store.save(user, vault().seal(updated)); return updated.access_token;
  }
  const calendarCall = async (user, suffix, options = {}) => jsonFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events${suffix}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await access(user)}` } });
  const asyncRoute = action => async (req, res, next) => { try { await action(req, res); } catch (error) { next(error); } };
  const requireConfig = (req, res, next) => configured() ? next() : res.status(503).json({ error: 'ربط Google Calendar يحتاج إعداد الخادم أولًا.', code: 'CALENDAR_SETUP_REQUIRED' });
  const done = (res, ok) => res.redirect(`${config.APP_URL.replace(/\/$/, '')}/?calendar=${ok ? 'connected' : 'failed'}`);
  router.get('/status', requireAuth, asyncRoute(async (req, res) => res.json({ configured: configured(), connected: configured() && !!await store.get(req.user.id) })));
  router.post('/connect', requireAuth, requireConfig, asyncRoute(async (req, res) => {
    const ticket = randomBytes(32).toString('hex');
    await store.state(digest(ticket), req.user.id, null, new Date(Date.now() + 600000).toISOString());
    const start = new URL(config.GOOGLE_REDIRECT_URI); start.pathname = start.pathname.replace(/\/callback$/, '/start'); start.search = new URLSearchParams({ ticket }).toString();
    res.json({ url: start.toString() });
  }));
  // Top-level navigation establishes a first-party cookie even when API and app use different domains.
  router.get('/start', requireConfig, asyncRoute(async (req, res) => {
    const row = await store.takeState(digest(String(req.query.ticket || '')));
    if (!row || row.binder !== null || Date.parse(row.expires_at) < Date.now()) return res.status(400).send('Connection link expired. Start again from AQL.');
    const state = randomBytes(32).toString('hex'); const binder = randomBytes(32).toString('hex');
    await store.state(digest(state), row.user_id, digest(binder), new Date(Date.now() + 600000).toISOString());
    const cookieName = `aql_calendar_${state.slice(0, 12)}`;
    res.cookie(cookieName, binder, { httpOnly: true, secure: config.GOOGLE_REDIRECT_URI.startsWith('https:'), sameSite: 'lax', maxAge: 600000, path: '/api/calendar' });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID, redirect_uri: config.GOOGLE_REDIRECT_URI, response_type: 'code', scope, access_type: 'offline', prompt: 'consent', state }).toString();
    res.redirect(url.toString());
  }));
  router.get('/callback', requireConfig, asyncRoute(async (req, res) => {
    const state = String(req.query.state || ''); const name = `aql_calendar_${state.slice(0, 12)}`;
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=')));
    const row = await store.takeState(digest(state));
    res.clearCookie(name, { path: '/api/calendar' });
    if (!row?.binder || digest(cookies[name] || '') !== row.binder || Date.parse(row.expires_at) < Date.now() || typeof req.query.code !== 'string' || req.query.error) return done(res, false);
    try {
      const tokens = await tokenRequest({ code: req.query.code, grant_type: 'authorization_code', redirect_uri: config.GOOGLE_REDIRECT_URI });
      if (!tokens.access_token || !tokens.scope?.split(' ').includes(scope)) return done(res, false);
      const previous = await store.get(row.user_id);
      const refresh = tokens.refresh_token || (previous ? vault().open(previous).refresh_token : null);
      if (!refresh) return done(res, false);
      await store.save(row.user_id, vault().seal({ ...tokens, refresh_token: refresh, expires: Date.now() + Number(tokens.expires_in || 3600) * 1000 }));
      done(res, true);
    } catch { done(res, false); }
  }));
  router.get('/events', requireAuth, requireConfig, asyncRoute(async (req, res) => {
    const from = new Date(); const until = new Date(from.getTime() + 14 * 86400000);
    const query = new URLSearchParams({ timeMin: from.toISOString(), timeMax: until.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    if (typeof req.query.pageToken === 'string') query.set('pageToken', req.query.pageToken.slice(0, 2000));
    const data = await calendarCall(req.user.id, `?${query}`);
    res.json({ events: (data.items || []).filter(event => event.status !== 'cancelled').map(event => ({ id: event.id, title: event.summary || '(بدون عنوان)', start: event.start, end: event.end, url: event.htmlLink })), nextPageToken: data.nextPageToken || null });
  }));
  router.post('/events', requireAuth, requireConfig, asyncRoute(async (req, res) => {
    let event; try { event = calendarEvent(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
    let created;
    try { created = await calendarCall(req.user.id, '', { method: 'POST', body: JSON.stringify(event) }); }
    catch (error) {
      if (error.googleStatus !== 409) throw error;
      created = await calendarCall(req.user.id, `/${event.id}`);
      if (created.summary !== event.summary || Date.parse(created.start?.dateTime) !== Date.parse(event.start.dateTime) || Date.parse(created.end?.dateTime) !== Date.parse(event.end.dateTime) || (created.description || '') !== event.description) return res.status(409).json({ error: 'الموعد محفوظ بالفعل ببيانات مختلفة؛ راجع التقويم.' });
    }
    res.json({ event: { id: created.id, url: created.htmlLink } });
  }));
  router.delete('/connection', requireAuth, requireConfig, asyncRoute(async (req, res) => {
    const saved = await store.get(req.user.id);
    if (saved) {
      const tokens = vault().open(saved);
      // Keep local connection on network failure so revocation can be retried.
      const response = await fetcher('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.refresh_token || tokens.access_token }), signal: AbortSignal.timeout(20000) });
      if (!response.ok && response.status !== 400) throw new Error('تعذّر إلغاء إذن Google. جرّب مرة أخرى.');
      await store.remove(req.user.id);
    }
    res.json({ disconnected: true });
  }));
  router.use((error, req, res, next) => { void next; res.status(error.status || (error.googleStatus === 401 || error.googleStatus === 403 ? 409 : 502)).json({ error: error.status ? error.message : 'تعذّر الوصول للتقويم. جرّب مجددًا أو أعد ربط الحساب.' }); });
  return router;
}
