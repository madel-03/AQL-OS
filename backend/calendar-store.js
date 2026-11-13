export function calendarStore(supabase) {
  const checked = result => { if (result.error) throw new Error('Calendar storage unavailable'); return result.data; };
  return {
    async get(user) { return checked(await supabase.from('calendar_connections').select('payload').eq('user_id', user).maybeSingle())?.payload || null; },
    async save(user, payload) { checked(await supabase.from('calendar_connections').upsert({ user_id: user, payload, updated_at: new Date().toISOString() })); },
    async remove(user) { checked(await supabase.from('calendar_connections').delete().eq('user_id', user)); },
    async state(id, user, binder, expires) { checked(await supabase.from('calendar_oauth_states').insert({ id, user_id: user, binder, expires_at: expires })); },
    async takeState(id) { return checked(await supabase.from('calendar_oauth_states').delete().eq('id', id).select().maybeSingle()); },
  };
}
