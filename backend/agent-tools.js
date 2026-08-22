// agent-tools.js — أدوات عَقْل: تنفيذ الحياة + المعرفة الحية

/* ========== محركات بحث مجانية (بدون مفاتيح) ========== */
async function wikipediaSearch(query, lang = 'ar') {
  const sub = lang === 'ar' ? 'ar' : 'en';
  const url = `https://${sub}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Wikipedia ' + res.status);
  const data = await res.json();
  return (data.query?.search || []).slice(0, 3).map((h) => ({
    source: 'Wikipedia',
    title: h.title,
    snippet: String(h.snippet || '').replace(/<[^>]+>/g, '').slice(0, 300),
    url: `https://${sub}.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/ /g, '_'))}`,
  }));
}

async function duckSearch(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('DuckDuckGo ' + res.status);
  const data = await res.json();
  const out = [];
  if (data.AbstractText) out.push({ source: 'DuckDuckGo', title: data.Heading || 'نتيجة', snippet: String(data.AbstractText).slice(0, 300), url: data.AbstractURL || '' });
  (data.RelatedTopics || []).slice(0, 3).forEach((t) => {
    if (t && t.Text) out.push({ source: 'DuckDuckGo', title: t.Text.slice(0, 60), snippet: t.Text.slice(0, 300), url: t.FirstURL || '' });
  });
  return out;
}

async function gatherWebResults(query, lang = 'ar') {
  const [wiki, duck] = await Promise.allSettled([wikipediaSearch(query, lang), duckSearch(query)]);
  return [
    ...(wiki.status === 'fulfilled' ? wiki.value : []),
    ...(duck.status === 'fulfilled' ? duck.value : []),
  ].slice(0, 5);
}

/* يبحث فقط إذا كانت الرسالة طلب بحث أو معرفة — يُستخدم في /api/chat */
export async function liveWebSearch(message, lang = 'ar') {
  const low = String(message || '').toLowerCase();
  const wants = /(ابحث|بحث|دور|فتش|search|find|look up|برنامج|برامج|program|software|تطبيق|موقع|أخبار|اخبار|news|wikipedia|ويكيبيديا|من هو|ما هو|who is|what is)/.test(low);
  if (!wants) return '';
  try {
    const results = await gatherWebResults(message, lang);
    return results.length ? JSON.stringify(results) : '';
  } catch (e) {
    return '';
  }
}

/* ========== سجل الأدوات ========== */
export const toolsRegistry = [
  {
    declaration: {
      name: 'web_search',
      description: 'Search the live web for real-time information, news, people, topics. Use when the user asks to search or find something online.',
      parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'what to search for' } }, required: ['query'] },
    },
    execute: async (userId, args) => {
      const q = String(args.query || '');
      const results = await gatherWebResults(q, 'ar');
      if (!results.length) return `no web results found for "${q}"`;
      return 'LIVE WEB RESULTS: ' + JSON.stringify(results);
    },
  },
  {
    declaration: {
      name: 'find_software',
      description: 'Find and recommend software, programs or apps for a purpose, with real links. Use when the user asks for a program or app.',
      parameters: { type: 'OBJECT', properties: { purpose: { type: 'STRING', description: 'what the program should do' }, platform: { type: 'STRING', description: 'windows|mac|android|ios|web|any' } }, required: ['purpose'] },
    },
    execute: async (userId, args) => {
      const purpose = String(args.purpose || '');
      const platform = String(args.platform || 'any');
      const results = await gatherWebResults(`best free ${purpose} software for ${platform}`, 'en');
      if (!results.length) return `no software results found for "${purpose}"`;
      return 'SOFTWARE RESULTS: ' + JSON.stringify(results);
    },
  },
  {
    declaration: {
      name: 'add_commitment',
      description: 'Add a new weekly time commitment',
      parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, hours_per_week: { type: 'NUMBER' }, type: { type: 'STRING', description: 'study|work|health|personal|sleep' }, intensity: { type: 'STRING', description: 'low|medium|high' }, time_slot: { type: 'STRING', description: 'morning|afternoon|evening|late_night|mixed' } }, required: ['title', 'hours_per_week'] },
    },
    execute: async (userId, args, { supabase }) => {
      const { data, error } = await supabase.from('commitments').insert({ user_id: userId, title: String(args.title || 'التزام جديد'), hours_per_week: Number(args.hours_per_week || 1), type: ['study', 'work', 'health', 'personal', 'sleep'].includes(args.type) ? args.type : 'personal', intensity: ['low', 'medium', 'high'].includes(args.intensity) ? args.intensity : 'medium', time_slot: ['morning', 'afternoon', 'evening', 'late_night', 'mixed'].includes(args.time_slot) ? args.time_slot : 'mixed', flexible: true, status: 'active' }).select().single();
      if (error) throw error;
      return `added commitment "${data.title}" (${data.hours_per_week}h/week)`;
    },
  },
  {
    declaration: {
      name: 'reduce_hours',
      description: 'Reduce weekly hours of an existing commitment (match by title)',
      parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, new_hours: { type: 'NUMBER' } }, required: ['title', 'new_hours'] },
    },
    execute: async (userId, args, { supabase }) => {
      const { data: row } = await supabase.from('commitments').select('*').eq('user_id', userId).eq('status', 'active').ilike('title', `%${String(args.title || '')}%`).maybeSingle();
      if (!row) return `commitment "${args.title}" not found`;
      const { error } = await supabase.from('commitments').update({ hours_per_week: Number(args.new_hours) }).eq('id', row.id);
      if (error) throw error;
      return `reduced "${row.title}" to ${args.new_hours}h/week`;
    },
  },
  {
    declaration: {
      name: 'archive_commitment',
      description: 'Archive/remove an existing commitment (match by title)',
      parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' } }, required: ['title'] },
    },
    execute: async (userId, args, { supabase }) => {
      const { data: row } = await supabase.from('commitments').select('*').eq('user_id', userId).eq('status', 'active').ilike('title', `%${String(args.title || '')}%`).maybeSingle();
      if (!row) return `commitment "${args.title}" not found`;
      const { error } = await supabase.from('commitments').update({ status: 'archived' }).eq('id', row.id);
      if (error) throw error;
      return `archived "${row.title}"`;
    },
  },
  {
    declaration: {
      name: 'create_goal',
      description: 'Create a strategic goal',
      parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' } }, required: ['title'] },
    },
    execute: async (userId, args, { supabase }) => {
      const { data, error } = await supabase.from('goals').insert({ user_id: userId, title: String(args.title || 'هدف جديد') }).select().single();
      if (error) throw error;
      return `created goal "${data.title}"`;
    },
  },
  {
    declaration: {
      name: 'add_expense',
      description: 'Record a financial expense or income',
      parameters: { type: 'OBJECT', properties: { amount: { type: 'NUMBER' }, kind: { type: 'STRING', description: 'expense|income' }, category: { type: 'STRING' } }, required: ['amount'] },
    },
    execute: async (userId, args, { supabase }) => {
      const { data, error } = await supabase.from('finance_entries').insert({ user_id: userId, type: args.kind === 'income' ? 'income' : 'expense', amount: Number(args.amount || 0), category: String(args.category || 'عام') }).select().single();
      if (error) throw error;
      return `recorded ${args.kind === 'income' ? 'income' : 'expense'} of ${args.amount} (${args.category || 'عام'})`;
    },
  },
  {
    declaration: {
      name: 'add_home_task',
      description: 'Add a home task',
      parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, priority: { type: 'STRING', description: 'low|medium|high|urgent' } }, required: ['title'] },
    },
    execute: async (userId, args, { supabase }) => {
      const { data, error } = await supabase.from('home_tasks').insert({ user_id: userId, title: String(args.title || 'مهمة'), priority: String(args.priority || 'medium') }).select().single();
      if (error) throw error;
      return `added home task "${args.title}"`;
    },
  },
  {
    declaration: {
      name: 'log_study',
      description: 'Log a study session',
      parameters: { type: 'OBJECT', properties: { subject: { type: 'STRING' }, duration_minutes: { type: 'NUMBER' } }, required: ['subject', 'duration_minutes'] },
    },
    execute: async (userId, args, { supabase }) => {
      const { data, error } = await supabase.from('study_sessions').insert({ user_id: userId, subject: String(args.subject || 'دراسة'), duration_minutes: Number(args.duration_minutes || 0) }).select().single();
      if (error) throw error;
      return `logged ${args.duration_minutes}min study of "${args.subject}"`;
    },
  },
  {
    declaration: {
      name: 'mark_contact',
      description: 'Mark that the user contacted a person today',
      parameters: { type: 'OBJECT', properties: { person_name: { type: 'STRING' } }, required: ['person_name'] },
    },
    execute: async (userId, args, { supabase }) => {
      const { data: row } = await supabase.from('relationships').select('id').eq('user_id', userId).ilike('person_name', `%${String(args.person_name || '')}%`).maybeSingle();
      if (!row) return `person "${args.person_name}" not found in relationships`;
      const { error } = await supabase.from('relationships').update({ last_contact: new Date().toISOString().slice(0, 10) }).eq('id', row.id);
      if (error) throw error;
      return `marked contact with "${args.person_name}" today`;
    },
  },
];

export const AGENT_TOOLS = toolsRegistry.map((t) => t.declaration);

const lowerSchema = (s) => {
  if (!s || typeof s !== 'object') return s;
  const out = { ...s };
  if (out.type) out.type = String(out.type).toLowerCase();
  if (out.properties) {
    const p = {};
    for (const k of Object.keys(out.properties)) p[k] = lowerSchema(out.properties[k]);
    out.properties = p;
  }
  return out;
};
export const getOpenAITools = () => toolsRegistry.map(tool => ({
  type: 'function',
  function: {
    name: tool.declaration.name,
    description: tool.declaration.description,
    parameters: lowerSchema(tool.declaration.parameters),
  },
}));

export const runAgentTool = async (userId, name, args, context) => {
  const tool = toolsRegistry.find((t) => t.declaration.name === name);
  if (!tool) {
    console.warn(`Tool ${name} called but not found.`);
    return `unknown tool ${name}`;
  }
  try {
    return await tool.execute(userId, args, context);
  } catch (e) {
    console.error(`Error executing ${name}:`, e.message);
    return `tool ${name} failed: ${e.message}`;
  }
};