import { calendarCrypto } from './calendar.js';
export function calendarReader({ store, config = process.env, fetcher = fetch }) {
  const value = key => String(config[key] || '').trim();
  return async (user, from, until) => {
    const saved = await store.get(user); if (!saved) return { connected: false, events: [] };
    const vault = calendarCrypto(value('CALENDAR_TOKEN_KEY')); let tokens = vault.open(saved);
    const json = async (url, options) => { const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(15000) }); const body = await response.json(); if (!response.ok) throw new Error('Calendar unavailable'); return body; };
    if (tokens.expires < Date.now() + 60000) {
      if (!tokens.refresh_token) throw new Error('Calendar reconnect required');
      const fresh = await json('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: value('GOOGLE_CLIENT_ID'), client_secret: value('GOOGLE_CLIENT_SECRET'), refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }) });
      if (!fresh.access_token) throw new Error('Calendar refresh failed');
      tokens = { ...tokens, ...fresh, expires: Date.now() + Number(fresh.expires_in || 3600) * 1000 }; await store.save(user, vault.seal(tokens));
    }
    let page; let events = [];
    for (let count = 0; count < 5; count++) {
      const query = new URLSearchParams({ timeMin: from, timeMax: until, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(page ? { pageToken: page } : {}) });
      const body = await json(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      events = [...events, ...(body.items || []).filter(item => item.status !== 'cancelled').map(item => ({ id: item.id, title: item.summary || '(بدون عنوان)', start: item.start }))];
      page = body.nextPageToken; if (!page) return { connected: true, events };
    }
    throw new Error('Calendar result limit');
  };
}
