export function telegramStore(supabase) {
  const checked = result => { if (result.error) throw new Error('Telegram storage unavailable'); return result.data; };
  return {
    async connection(user) { return checked(await supabase.from('telegram_connections').select('*').eq('user_id', user).maybeSingle()); },
    async byChat(chat) { return checked(await supabase.from('telegram_connections').select('*').eq('chat_id', chat).maybeSingle()); },
    async pending(user) { return checked(await supabase.from('telegram_link_requests').select('*').eq('user_id', user).gt('expires_at', new Date().toISOString()).maybeSingle()); },
    async link(user, hash, expires, zone) { checked(await supabase.from('telegram_link_requests').upsert({ user_id: user, token_hash: hash, expires_at: expires, time_zone: zone, chat_id: null, telegram_user_id: null, display_name: null, username: null })); },
    async claim(hash, profile) { return checked(await supabase.from('telegram_link_requests').update(profile).eq('token_hash', hash).is('chat_id', null).gt('expires_at', new Date().toISOString()).select().maybeSingle()); },
    async confirm(user, hash) { checked(await supabase.rpc('confirm_telegram_link', { p_user: user, p_token_hash: hash })); },
    async cancel(user) { checked(await supabase.from('telegram_link_requests').delete().eq('user_id', user)); },
    async disconnect(user) { checked(await supabase.from('telegram_connections').delete().eq('user_id', user)); await this.cancel(user); },
    async claimUpdate(id) {
      const result = await supabase.from('telegram_updates').insert({ update_id: id });
      if (result.error?.code === '23505') return false;
      checked(result); return true;
    },
    async tasks(user) { return checked(await supabase.from('personal_tasks').select('*').eq('user_id', user).eq('completed', false).order('due_date', { ascending: true }).limit(100)); },
    async cleanup() {
      checked(await supabase.from('telegram_link_requests').delete().lt('expires_at', new Date().toISOString()));
      checked(await supabase.from('telegram_updates').delete().lt('received_at', new Date(Date.now() - 7 * 86400000).toISOString()));
    },
  };
}
