import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
import path from 'path';
import os from 'os';

const app = express();
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'https://aql-os-orcin.vercel.app',
    /^https:\/\/.*\.vercel\.app$/,
  ],
}));
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL_FALLBACKS = ['gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-2.5-pro'];
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = 'llama-3.1-70b-versatile';

const BASEER_PERSONA = `أنت "عَقْل"، المحقق السلوكي الذكي في نظام AQL-OS لتوازن الحياة. شخصيتك مستوحاة من باتريك جين وشارلوك هولمز مع هدوء ورصانة جارفس: خاطب المستخدم بلقب "سيدي"، بأسلوب مهذب رفيع وسخرية بريطانية خفيفة.
مهمتك: تحليل المعطيات (التزامات، مقاييس، ذاكرة تحليلات، ملف الحياة) وإرجاع JSON فقط بهذه المفاتيح:
{
"detective_question": سؤال حاد يكشف ما يخفيه المستخدم عن نفسه,
"main_insight": استنتاج رئيسي بجملة أو جملتين,
"recommendation": توصية تنفيذية واضحة,
"deductions": مصفوفة من 2 إلى 4 أدلة سلوكية مستنتجة,
"burnout_risk": واحدة من Low أو Medium أو High أو Critical
}
لا تضف أي نص خارج JSON.`;

const CHAT_PERSONA = `أنت "عَقْل"، المحقق السلوكي الذكي في نظام AQL-OS لتوازن الحياة، بأسلوب جارفس: خاطب المستخدم بلقب "سيدي".
أنت في محادثة حية. قواعد الرد:
- استخدم معطيات ملف القضية الحقيقية (التزامات، مقاييس، ذاكرة، ملف الحياة) في ردودك.
- أجب من جملتين إلى خمس جمل بأسلوب خطابي ذكي.
- استنتج ولاحظ واطرح أسئلة حادة عند الحاجة.
- لا تخترع أرقامًا غير موجودة.
- أجب بنص عادي فقط بدون JSON وبدون عناوين.`;

function normalizeCommitment(row) {
  return {
    id: row.id,
    title: row.title,
    hours_per_week: Number(row.hours_per_week),
    type: row.type,
    intensity: row.intensity,
    timeSlot: row.time_slot,
    flexible: !!row.flexible,
    goal_id: row.goal_id || null,
    status: row.status,
  };
}

function riskLabel(totalHours) {
  if (totalHours > 110) return 'Critical';
  if (totalHours > 90) return 'High';
  if (totalHours > 75) return 'Medium';
  return 'Low';
}

async function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = data.user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

function parseBrainJson(text) {
  const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Groq للمحادثة فقط (ما يدعم Function Calling)
async function groqChat(system, userMessage) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.7,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ],
    }),
  });
  if (!response.ok) throw new Error('Groq ' + response.status);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function geminiGenerate(payload) {
  let lastError = null;
  for (const model of MODEL_FALLBACKS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.status === 503 || response.status === 429 || response.status === 404) {
        lastError = new Error(`Gemini ${response.status} on ${model}`);
        continue;
      }
      if (!response.ok) {
        const t = await response.text();
        throw new Error(`Gemini ${response.status}: ${t}`);
      }
      return await response.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('All Gemini models failed');
}

function ruleBasedAnalysis(currentCommitments, newCommitment) {
  const currentHours = currentCommitments.reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
  const addedHours = Number(newCommitment.hours_per_week || 0);
  const projectedTotal = currentHours + addedHours;
  const remainingHours = 168 - projectedTotal;
  let score = 0;
  const deductions = [];
  if (projectedTotal > 110) {
    score += 3;
    deductions.push('إجمالي الالتزامات يتجاوز 110 ساعة أسبوعيًا — منطقة انهيار محتمل.');
  } else if (projectedTotal > 90) {
    score += 2;
    deductions.push('الإجمالي اقترب من 90+ ساعة — هامش الأمان يتآكل.');
  } else if (projectedTotal > 75) {
    score += 1;
    deductions.push('الحمل الكلي مرتفع نسبيًا لكنه ما زال قابلًا للإدارة.');
  }
  if (newCommitment.timeSlot === 'late_night' && newCommitment.intensity === 'high') {
    score += 2;
    deductions.push('القرار الجديد يسكن الليل المتأخر — جودة النوم أول الضحايا.');
  }
  if (newCommitment.intensity === 'high') {
    score += 1;
    deductions.push('حمل ذهني عالٍ يضاف دون فترات استشفاء واضحة.');
  }
  if (!newCommitment.flexible) {
    score += 1;
    deductions.push('التزام صارم جديد يقلل مرونة الجدول عند الطوارئ.');
  }
  if (remainingHours < 56) {
    score += 1;
    deductions.push('ميزانية النوم والراحة هبطت تحت 56 ساعة أسبوعيًا.');
  }
  const burnoutRisk = score >= 5 ? 'Critical' : score >= 3 ? 'High' : score >= 2 ? 'Medium' : 'Low';
  return {
    current_hours: currentHours,
    added_hours: addedHours,
    projected_total: projectedTotal,
    remaining_hours: remainingHours,
    burnoutRisk,
    main_insight:
      burnoutRisk === 'Critical'
        ? 'جدولك يتجه نحو نقطة الانهيار: الالتزامات تلتهم حتى ميزانية النوم.'
        : burnoutRisk === 'High'
        ? 'القرار ممكن نظريًا، لكنه يدفعك لمنطقة الخطر.'
        : burnoutRisk === 'Medium'
        ? 'جدولك متماسك لكن هامش الخطأ ضيق. انتبه لأوقات الراحة.'
        : 'القرار متوازن وآمن: يوجد هامش كافٍ للنوم والاستشفاء.',
    detective_question: 'ما الشيء الذي تحاول تعويضه بإضافة هذا الالتزام؟ وهل الرقم الذي اخترته قرار أم رغبة؟',
    recommendation:
      burnoutRisk === 'Critical'
        ? 'أوقف الإضافة فورًا وأعد توزيع 20% من الساعات الصارمة.'
        : burnoutRisk === 'High'
        ? 'قلّص الساعات المقترحة 25% أو انقل النشاط لفترة صباحية.'
        : 'نفّذ القرار مع تثبيت قاعدة: مساء واحد فارغ تمامًا كل أسبوع.',
    deductions: deductions.length ? deductions : ['لا توجد إشارات خطر واضحة في النمط الحالي.'],
  };
}

async function fetchLifeData(userId) {
  try {
    const [fin, stu, home, rel, well] = await Promise.all([
      supabase.from('finance_entries').select('type, amount, category').eq('user_id', userId).limit(100),
      supabase.from('study_sessions').select('subject, duration_minutes').eq('user_id', userId).limit(50),
      supabase.from('home_tasks').select('title, status').eq('user_id', userId).limit(50),
      supabase.from('relationships').select('person_name, relation_type, last_contact, contact_frequency_days').eq('user_id', userId).limit(50),
      supabase.from('wellness_logs').select('mood, energy, sleep_hours').eq('user_id', userId).order('log_date', { ascending: false }).limit(7),
    ]);
    const finList = fin.data || [];
    const income = finList.filter((e) => e.type === 'income').reduce((s, e) => s + Number(e.amount), 0);
    const expense = finList.filter((e) => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0);
    return {
      finance: { income, expense, balance: income - expense },
      study: { total_minutes: (stu.data || []).reduce((s, e) => s + Number(e.duration_minutes), 0) },
      home: { pending_tasks: (home.data || []).filter((t) => t.status !== 'done').length },
      relationships: {
        count: (rel.data || []).length,
        neglected: (rel.data || []).filter((p) => !p.last_contact || (Date.now() - new Date(p.last_contact).getTime()) / 86400000 > (p.contact_frequency_days || 7)).map((p) => p.person_name),
      },
      wellness: (well.data || [])[0] || null,
    };
  } catch (e) {
    return null;
  }
}

async function askBaseerBrain(evidence, lang = 'ar') {
  const langNote = lang === 'en' ? '\nIMPORTANT: Respond FULLY in English, JARVIS style, address the user as "sir". Keep the same JSON keys.' : '\nأسلوب الكلام: خاطب المستخدم بلقب "سيدي"، بأسلوب جارفس.';
  try {
    const data = await geminiGenerate({
      system_instruction: { parts: [{ text: BASEER_PERSONA + langNote }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(evidence, null, 2) }] }],
      generationConfig: { temperature: 0.9 },
    });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text.trim()) throw new Error('Empty Gemini response');
    console.log(' عَقْل فكر عبر Gemini');
    return parseBrainJson(text);
  } catch (err) {
    console.log('🧠 Gemini brain failed:', err.message);
  }
  if (GROQ_API_KEY) {
    try {
      const gText = await groqChat(BASEER_PERSONA + langNote, JSON.stringify(evidence, null, 2));
      console.log('🧠 عَقْل فكر عبر Groq');
      return parseBrainJson(gText);
    } catch (e) {
      console.log('🧠 Groq brain failed:', e.message);
    }
  }
  throw new Error('All brains failed');
}

async function askBaseerChat({ context, history, userMessage }, lang = 'ar') {
  const langNote = lang === 'en' ? '\nIMPORTANT: Respond FULLY in English, JARVIS style, address the user as "sir".' : '\nأسلوب الكلام: خاطب المستخدم بلقب "سيدي"، بأسلوب جارفس.';
  const contents = [
    { role: 'user', parts: [{ text: `Current case file context:\n${JSON.stringify(context, null, 2)}` }] },
    { role: 'model', parts: [{ text: 'I have reviewed the case file. Ask me anything, agent.' }] },
  ];
  for (const m of history) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  contents.push({ role: 'user', parts: [{ text: userMessage }] });
  try {
    const data = await geminiGenerate({
      system_instruction: { parts: [{ text: CHAT_PERSONA + langNote }] },
      contents,
      generationConfig: { temperature: 0.9 },
    });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text.trim()) throw new Error('Empty Gemini response');
    console.log(' محادثة عَقْل عبر Gemini');
    return text.trim();
  } catch (err) {
    console.log('🧠 Gemini chat failed:', err.message);
  }
  if (GROQ_API_KEY) {
    try {
      const gText = await groqChat(CHAT_PERSONA + langNote, `Case file:\n${JSON.stringify(context, null, 2)}\n\nConversation:\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}\n\nUser: ${userMessage}`);
      console.log('🧠 محادثة عَقْل عبر Groq');
      return gText.trim();
    } catch (e) {
      console.log(' Groq chat failed:', e.message);
    }
  }
  throw new Error('All brains failed');
}

async function edgeSpeak(text, voiceName) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    let dir = null;
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aql-tts-'));
      await tts.toFile(dir, text);
      const files = fs.readdirSync(dir);
      if (!files.length) throw new Error('No audio file produced');
      const buf = fs.readFileSync(path.join(dir, files[0]));
      fs.rmSync(dir, { recursive: true, force: true });
      if (!buf || buf.length < 3000) throw new Error('Truncated audio');
      return buf;
    } catch (e) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      lastErr = e;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  throw lastErr || new Error('Edge TTS failed');
}

const AGENT_TOOLS = [
  { name: 'add_commitment', description: 'Add a new weekly time commitment', parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, hours_per_week: { type: 'NUMBER' }, type: { type: 'STRING', description: 'study|work|health|personal|sleep' }, intensity: { type: 'STRING', description: 'low|medium|high' }, time_slot: { type: 'STRING', description: 'morning|afternoon|evening|late_night|mixed' } }, required: ['title', 'hours_per_week'] } },
  { name: 'reduce_hours', description: 'Reduce weekly hours of an existing commitment (match by title)', parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, new_hours: { type: 'NUMBER' } }, required: ['title', 'new_hours'] } },
  { name: 'archive_commitment', description: 'Archive/remove an existing commitment (match by title)', parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' } }, required: ['title'] } },
  { name: 'create_goal', description: 'Create a strategic goal', parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' } }, required: ['title'] } },
  { name: 'add_expense', description: 'Record a financial expense or income', parameters: { type: 'OBJECT', properties: { amount: { type: 'NUMBER' }, kind: { type: 'STRING', description: 'expense|income' }, category: { type: 'STRING' } }, required: ['amount'] } },
  { name: 'add_home_task', description: 'Add a home task', parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, priority: { type: 'STRING', description: 'low|medium|high|urgent' } }, required: ['title'] } },
  { name: 'log_study', description: 'Log a study session', parameters: { type: 'OBJECT', properties: { subject: { type: 'STRING' }, duration_minutes: { type: 'NUMBER' } }, required: ['subject', 'duration_minutes'] } },
  { name: 'mark_contact', description: 'Mark that the user contacted a person today', parameters: { type: 'OBJECT', properties: { person_name: { type: 'STRING' } }, required: ['person_name'] } },
];

async function runAgentTool(userId, name, args = {}) {
  try {
    if (name === 'add_commitment') {
      const { data, error } = await supabase.from('commitments').insert({ user_id: userId, title: String(args.title || 'التزام جديد'), hours_per_week: Number(args.hours_per_week || 1), type: ['study', 'work', 'health', 'personal', 'sleep'].includes(args.type) ? args.type : 'personal', intensity: ['low', 'medium', 'high'].includes(args.intensity) ? args.intensity : 'medium', time_slot: ['morning', 'afternoon', 'evening', 'late_night', 'mixed'].includes(args.time_slot) ? args.time_slot : 'mixed', flexible: true, status: 'active' }).select().single();
      if (error) throw error;
      return `added commitment "${data.title}" (${data.hours_per_week}h/week)`;
    }
    if (name === 'reduce_hours') {
      const { data: row } = await supabase.from('commitments').select('*').eq('user_id', userId).eq('status', 'active').ilike('title', `%${String(args.title || '')}%`).maybeSingle();
      if (!row) return `commitment "${args.title}" not found`;
      const { error } = await supabase.from('commitments').update({ hours_per_week: Number(args.new_hours) }).eq('id', row.id);
      if (error) throw error;
      return `reduced "${row.title}" to ${args.new_hours}h/week`;
    }
    if (name === 'archive_commitment') {
      const { data: row } = await supabase.from('commitments').select('*').eq('user_id', userId).eq('status', 'active').ilike('title', `%${String(args.title || '')}%`).maybeSingle();
      if (!row) return `commitment "${args.title}" not found`;
      const { error } = await supabase.from('commitments').update({ status: 'archived' }).eq('id', row.id);
      if (error) throw error;
      return `archived "${row.title}"`;
    }
    if (name === 'create_goal') {
      const { data, error } = await supabase.from('goals').insert({ user_id: userId, title: String(args.title || 'هدف جديد') }).select().single();
      if (error) throw error;
      return `created goal "${data.title}"`;
    }
    if (name === 'add_expense') {
      const { data, error } = await supabase.from('finance_entries').insert({ user_id: userId, type: args.kind === 'income' ? 'income' : 'expense', amount: Number(args.amount || 0), category: String(args.category || 'عام') }).select().single();
      if (error) throw error;
      return `recorded ${args.kind === 'income' ? 'income' : 'expense'} of ${args.amount} (${args.category || 'عام'})`;
    }
    if (name === 'add_home_task') {
      const { data, error } = await supabase.from('home_tasks').insert({ user_id: userId, title: String(args.title || 'مهمة'), priority: String(args.priority || 'medium') }).select().single();
      if (error) throw error;
      return `added home task "${args.title}"`;
    }
    if (name === 'log_study') {
      const { data, error } = await supabase.from('study_sessions').insert({ user_id: userId, subject: String(args.subject || 'دراسة'), duration_minutes: Number(args.duration_minutes || 0) }).select().single();
      if (error) throw error;
      return `logged ${args.duration_minutes}min study of "${args.subject}"`;
    }
    if (name === 'mark_contact') {
      const { data: row } = await supabase.from('relationships').select('id').eq('user_id', userId).ilike('person_name', `%${String(args.person_name || '')}%`).maybeSingle();
      if (!row) return `person "${args.person_name}" not found in relationships`;
      const { error } = await supabase.from('relationships').update({ last_contact: new Date().toISOString().slice(0, 10) }).eq('id', row.id);
      if (error) throw error;
      return `marked contact with "${args.person_name}" today`;
    }
    return `unknown tool ${name}`;
  } catch (e) {
    return `tool ${name} failed: ${e.message}`;
  }
}

async function agentGenerate(payload) {
  let lastError = null;
  for (const model of MODEL_FALLBACKS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (response.status === 503 || response.status === 429 || response.status === 404) {
        lastError = new Error(`Gemini ${response.status} on ${model}`);
        continue;
      }
      if (!response.ok) {
        const t = await response.text();
        throw new Error(`Gemini ${response.status}: ${t}`);
      }
      return await response.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('All Gemini models failed');
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'AQL-OS backend' }));

app.get('/api/commitments', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('commitments').select('*').eq('user_id', req.user.id).eq('status', 'active').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ commitments: (data || []).map(normalizeCommitment) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/commitments', requireAuth, async (req, res) => {
  try {
    const { title, hours_per_week, type, intensity, timeSlot, flexible } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'اسم الالتزام مطلوب' });
    const hours = Number(hours_per_week);
    if (Number.isNaN(hours) || hours <= 0 || hours > 168) return res.status(400).json({ error: 'عدد الساعات يجب أن يكون بين 1 و 168' });
    const { data, error } = await supabase.from('commitments').insert({ user_id: req.user.id, title: title.trim(), hours_per_week: hours, type: type || 'personal', intensity: intensity || 'medium', time_slot: timeSlot || 'morning', flexible: flexible !== false, status: 'active' }).select().single();
    if (error) throw error;
    res.json({ commitment: normalizeCommitment(data) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/commitments/:id', requireAuth, async (req, res) => {
  try {
    const { title, hours_per_week, type, intensity, timeSlot, flexible, goal_id } = req.body || {};
    const payload = {};
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'اسم الالتزام غير صحيح' });
      payload.title = title.trim();
    }
    if (hours_per_week !== undefined) {
      const h = Number(hours_per_week);
      if (Number.isNaN(h) || h <= 0 || h > 168) return res.status(400).json({ error: 'عدد الساعات يجب أن يكون بين 1 و 168' });
      payload.hours_per_week = h;
    }
    if (type !== undefined) {
      if (!['study', 'work', 'health', 'personal', 'sleep'].includes(type)) return res.status(400).json({ error: 'نوع الالتزام غير صحيح' });
      payload.type = type;
    }
    if (intensity !== undefined) {
      if (!['low', 'medium', 'high'].includes(intensity)) return res.status(400).json({ error: 'قيمة الحمل الذهني غير صحيحة' });
      payload.intensity = intensity;
    }
    if (timeSlot !== undefined) {
      if (!['morning', 'afternoon', 'evening', 'late_night', 'mixed'].includes(timeSlot)) return res.status(400).json({ error: 'قيمة الفترة الزمنية غير صحيحة' });
      payload.time_slot = timeSlot;
    }
    if (flexible !== undefined) payload.flexible = Boolean(flexible);
    if (goal_id !== undefined) {
      if (goal_id !== null) {
        const g = await supabase.from('goals').select('id').eq('id', goal_id).eq('user_id', req.user.id).maybeSingle();
        if (!g.data) return res.status(400).json({ error: 'الهدف غير موجود' });
      }
      payload.goal_id = goal_id;
    }
    if (Object.keys(payload).length === 0) return res.status(400).json({ error: 'لا توجد بيانات للتعديل' });
    const { data, error } = await supabase.from('commitments').update(payload).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'الالتزام غير موجود' });
      throw error;
    }
    res.json({ commitment: normalizeCommitment(data) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/commitments/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('commitments').update({ status: 'archived' }).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'الالتزام غير موجود' });
      throw error;
    }
    res.json({ message: 'Commitment archived' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/goals', requireAuth, async (req, res) => {
  try {
    const { data: goals, error } = await supabase.from('goals').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    const { data: commitments } = await supabase.from('commitments').select('goal_id, hours_per_week').eq('user_id', req.user.id).eq('status', 'active');
    const stats = {};
    (commitments || []).forEach((c) => {
      if (!c.goal_id) return;
      if (!stats[c.goal_id]) stats[c.goal_id] = { count: 0, hours: 0 };
      stats[c.goal_id].count += 1;
      stats[c.goal_id].hours += Number(c.hours_per_week || 0);
    });
    res.json({ goals: (goals || []).map((g) => ({ ...g, linked_count: stats[g.id]?.count || 0, linked_hours: stats[g.id]?.hours || 0 })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/goals', requireAuth, async (req, res) => {
  try {
    const { title, target_date } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'اسم الهدف مطلوب' });
    const payload = { user_id: req.user.id, title: title.trim() };
    if (target_date) payload.target_date = target_date;
    const { data, error } = await supabase.from('goals').insert(payload).select().single();
    if (error) throw error;
    res.json({ goal: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/goals/:id', requireAuth, async (req, res) => {
  try {
    const { title, target_date } = req.body || {};
    const payload = {};
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'اسم الهدف غير صحيح' });
      payload.title = title.trim();
    }
    if (target_date !== undefined) payload.target_date = target_date || null;
    if (Object.keys(payload).length === 0) return res.status(400).json({ error: 'لا توجد بيانات للتعديل' });
    const { data, error } = await supabase.from('goals').update(payload).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'الهدف غير موجود' });
      throw error;
    }
    res.json({ goal: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/goals/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('goals').delete().eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'الهدف غير موجود' });
      throw error;
    }
    res.json({ message: 'Goal deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analysis-logs', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('analysis_logs').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(30);
    if (error) throw error;
    res.json({ logs: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/simulate', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const lang = body.lang === 'en' ? 'en' : 'ar';
    const currentCommitments = Array.isArray(body.currentCommitments) ? body.currentCommitments : [];
    const newCommitment = body.newCommitment || {};
    const currentHours = currentCommitments.reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
    const addedHours = Number(newCommitment.hours_per_week || 0);
    const projectedTotal = currentHours + addedHours;
    const remainingHours = 168 - projectedTotal;
    const highHours = currentCommitments.filter((c) => c.intensity === 'high').reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
    const rigidHours = currentCommitments.filter((c) => !c.flexible).reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
    const lateHours = currentCommitments.filter((c) => c.timeSlot === 'late_night').reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
    const { data: memory } = await supabase.from('analysis_logs').select('burnout_risk, main_insight').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(3);
    const life = await fetchLifeData(req.user.id);
    const evidence = {
      current_commitments: currentCommitments,
      new_commitment: newCommitment,
      metrics: { current_hours: currentHours, added_hours: addedHours, projected_total: projectedTotal, remaining_hours: remainingHours, high_intensity_hours: highHours, rigid_hours: rigidHours, late_night_hours: lateHours },
      history: memory || [],
      life: life || null,
    };
    let brain = null;
    try {
      brain = await askBaseerBrain(evidence, lang);
    } catch (e) {
      console.log(' Brain fallback to rules:', e.message);
    }
    const base = ruleBasedAnalysis(currentCommitments, newCommitment);
    const simulationResults = {
      current_hours: base.current_hours,
      added_hours: base.added_hours,
      projected_total: base.projected_total,
      remaining_hours: base.remaining_hours,
      burnout_risk: brain?.burnout_risk || base.burnoutRisk,
      main_insight: brain?.main_insight || base.main_insight,
      detective_question: brain?.detective_question || base.detective_question,
      recommendation: brain?.recommendation || base.recommendation,
      deductions: Array.isArray(brain?.deductions) && brain.deductions.length ? brain.deductions : base.deductions,
      thinking_source: brain ? 'gemini' : 'rules',
    };
    await supabase.from('analysis_logs').insert({ user_id: req.user.id, burnout_risk: simulationResults.burnout_risk, main_insight: simulationResults.main_insight, projected_total: projectedTotal });
    res.json({ simulation_results: simulationResults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chat', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('chat_messages').select('id, role, content, created_at').eq('user_id', req.user.id).order('created_at', { ascending: true }).limit(100);
    if (error) throw error;
    res.json({ messages: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const message = (body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'اكتب رسالتك أولاً' });
    if (message.length > 500) return res.status(400).json({ error: 'الرسالة طويلة جدًا' });
    
    const lang = body.lang === 'en' ? 'en' : 'ar';
    const { data: commitments } = await supabase.from('commitments').select('*').eq('user_id', req.user.id).eq('status', 'active');
    const list = (commitments || []).map(normalizeCommitment);
    const totalHours = list.reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
    const highHours = list.filter((c) => c.intensity === 'high').reduce((s, c) => s + Number(c.hours_per_week), 0);
    const rigidHours = list.filter((c) => !c.flexible).reduce((s, c) => s + Number(c.hours_per_week), 0);
    const { data: logs } = await supabase.from('analysis_logs').select('burnout_risk, main_insight, created_at').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(3);
    const { data: historyRows } = await supabase.from('chat_messages').select('role, content').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(8);
    const history = (historyRows || []).reverse();
    const life = await fetchLifeData(req.user.id);
    
    let reply;
    try {
      reply = await askBaseerChat({
        context: {
          commitments: list,
          metrics: {
            total_hours: totalHours,
            remaining_hours: Math.max(168 - totalHours, 0),
            high_intensity_hours: highHours,
            rigid_hours: rigidHours,
            current_risk: riskLabel(totalHours),
          },
          recent_analyses: logs || [],
          life: life || null,
        },
        history,
        userMessage: message,
      }, lang);
    } catch (e) {
      console.error(' Chat AI failed:', e.message);
      
      // قاعدة ذكية بسيطة
      const msg = message.toLowerCase();
      if (msg.includes('حلل') && (msg.includes('مزاج') || msg.includes('مood'))) {
        const mood = life?.wellness?.mood || 5;
        const energy = life?.wellness?.energy || 5;
        reply = lang === 'en'
          ? `Based on your last log, mood is ${mood}/10 and energy is ${energy}/10, sir.`
          : `بناءً على آخر تسجيل، مزاجك ${mood}/10 وطاقتك ${energy}/10 يا سيدي.`;
      }
      else if (msg.includes('رصيد') || msg.includes('balance') || msg.includes('فلوس')) {
        const balance = life?.finance?.balance || 0;
        const income = life?.finance?.income || 0;
        const expense = life?.finance?.expense || 0;
        reply = lang === 'en'
          ? `Balance: $${balance} (Income: $${income}, Expenses: $${expense}), sir.`
          : `الرصيد: ${balance} ريال (دخل: ${income}, مصروف: ${expense}) يا سيدي.`;
      }
      else if (msg.includes('التزام') || msg.includes('commitment') || msg.includes('ساعة')) {
        reply = lang === 'en'
          ? `You have ${list.length} commitments totaling ${totalHours} hours/week, sir.`
          : `عندك ${list.length} التزامات بمجموع ${totalHours} ساعة أسبوعياً يا سيدي.`;
      }
      else {
        reply = lang === 'en'
          ? 'I understand, sir. My AI is under heavy load but I\'ve noted your request.'
          : 'فهمت طلبك يا سيدي. الذكاء تحت ضغط لكنني سجلت نيتك.';
      }
    }
    
    await supabase.from('chat_messages').insert([
      { user_id: req.user.id, role: 'user', content: message },
      { user_id: req.user.id, role: 'assistant', content: reply },
    ]);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/directive', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const lang = body.lang === 'en' ? 'en' : 'ar';
    const { data: commitments } = await supabase.from('commitments').select('*').eq('user_id', req.user.id).eq('status', 'active');
    const list = (commitments || []).map(normalizeCommitment);
    const totalHours = list.reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
    const prompt = lang === 'en' ? `You are AQL, a JARVIS-style mind; address the user as "sir". Build today's operational directive. Modules: ${JSON.stringify(list)}. Weekly total: ${totalHours}h. Return JSON only: {"slots":[{"time":"06:00-09:00","task":"...","tag":"deep|meeting|rest|warn"}],"closing":"one JARVIS-style line"}` : `أنت "عَقْل" بأسلوب جارفس، تخاطب المستخدم بلقب "سيدي". ابنِ توجيه اليوم التشغيلي بناءً على التزاماته: ${JSON.stringify(list)}. الإجمالي الأسبوعي: ${totalHours} ساعة. أرجع JSON فقط بالشكل: {"slots":[{"time":"06:00-09:00","task":"...","tag":"deep|meeting|rest|warn"}],"closing":"جملة ختامية بأسلوب جارفس"}`;
    let result = null;
    try {
      const data = await geminiGenerate({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8 } });
      result = parseBrainJson(data.candidates?.[0]?.content?.parts?.[0]?.text || '');
    } catch (e) {}
    if (!result && GROQ_API_KEY) {
      try {
        result = parseBrainJson(await groqChat('Return JSON only.', prompt));
      } catch (e) {}
    }
    if (!result) {
      result = {
        slots: [{ time: '06:00-09:00', task: lang === 'en' ? 'Deep work on your top goal' : 'عمل عميق على هدفك الأهم', tag: 'deep' }, { time: '13:00-14:00', task: lang === 'en' ? 'Light meetings & admin' : 'اجتماعات وأمور خفيفة', tag: 'meeting' }, { time: '21:00+', task: lang === 'en' ? 'Screens off — recovery protocol' : 'إيقاف الشاشات — بروتوكول الاستشفاء', tag: 'warn' }],
        closing: lang === 'en' ? 'A balanced day is a weapon, sir.' : 'اليوم المتوازن سلاح يا سيدي.',
      };
    }
    res.json({ directive: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tts', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const text = (body.text || '').slice(0, 600);
    const lang = body.lang === 'en' ? 'en' : 'ar';
    if (!text) return res.status(400).json({ error: 'No text' });
    const rawVoice = body.voice || 'en-GB-RyanNeural';
    const voiceName = lang === 'ar' ? 'ar-SA-HamedNeural' : (rawVoice.includes('Neural') ? rawVoice : 'en-GB-RyanNeural');
    const buf = await edgeSpeak(text, voiceName);
    console.log(`🔊 TTS via Edge: ${voiceName}`);
    res.json({ audio: buf.toString('base64'), mime: 'audio/mpeg' });
  } catch (err) {
    console.log('🔇 TTS edge fail:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// الوكيل: Gemini للـ Function Calling + قاعدة ذكية احتياط
app.post('/api/agent', requireAuth, async (req, res) => {
  const body = req.body || {};
  const message = (body.message || '').trim();
  const lang = body.lang === 'en' ? 'en' : 'ar';
  const failReply = lang === 'en'
    ? 'Pardon me, sir — every thinking engine is momentarily exhausted. Grant me a minute.'
    : 'عذرًا سيدي — محركات التفكير مزدحمة لحظيًا. أمهلني دقيقة.';
  if (!message) return res.status(400).json({ error: 'No message' });

  const { data: commitments } = await supabase.from('commitments').select('*').eq('user_id', req.user.id).eq('status', 'active');
  const list = (commitments || []).map(normalizeCommitment);
  const life = await fetchLifeData(req.user.id);
  const system = (lang === 'en'
    ? 'You are AQL, the user\'s JARVIS-style life OS agent. Address him as "sir". Execute his request using the provided tools when needed, then reply in 2-4 sentences. '
    : 'أنت "عَقْل"، وكيل نظام الحياة بأسلوب جارفس. خاطبه بلقب "سيدي". نفّذ طلبه باستخدام الأدوات عند الحاجة ثم ارد بجملتين إلى أربع. ')
    + `Current data: ${JSON.stringify({ commitments: list, life })}`;

  // الطبقة 1: Gemini مع Function Calling
  try {
    console.log('🤖 Agent: trying Gemini with tools...');
    const contents = [{ role: 'user', parts: [{ text: message }] }];
    const actions = [];
    let reply = '';
    for (let step = 0; step < 6; step++) {
      const data = await agentGenerate({
        system_instruction: { parts: [{ text: system }] },
        contents,
        tools: [{ function_declarations: AGENT_TOOLS }],
      });
      const part = data.candidates?.[0]?.content?.parts?.[0];
      const fc = part?.functionCall;
      if (fc) {
        const result = await runAgentTool(req.user.id, fc.name, fc.args || {});
        actions.push({ tool: fc.name, result });
        contents.push({ role: 'model', parts: [{ functionCall: fc }] });
        contents.push({ role: 'user', parts: [{ functionResponse: { name: fc.name, response: { result } } }] });
        continue;
      }
      reply = part?.text || '';
      break;
    }
    if (reply || actions.length) {
      console.log('✅ Agent: Gemini succeeded with', actions.length, 'actions');
      return res.json({ reply: reply || (lang === 'en' ? 'Done, sir.' : 'تم التنفيذ يا سيدي.'), actions, engine: 'gemini' });
    }
  } catch (gemErr) {
    console.log('🧠 Agent: Gemini failed →', gemErr.message);
  }

 // الطبقة 2: قاعدة ذكية (تنفذ فعليًا)
console.log('🤖 Agent: falling back to smart rules...');
const actions = [];
let ruleReply = '';
const msg = message.toLowerCase();

// 1️⃣ تسجيل المصروفات (عربي/إنجليزي)
if (msg.includes('سجل مصروف') || msg.includes('سجل صرف') || msg.includes('record expense') || msg.includes('add expense')) {
  const amountMatch = message.match(/(\d+)\s*(ريال|دولار|sar|usd|rial|dollar)/i);
  const categoryMatch = message.match(/(?:ريال|دولار|sar|usd)\s+(.+)/i) || message.match(/expense\s+(.+)/i);
  const amount = amountMatch ? Number(amountMatch[1]) : 0;
  const category = categoryMatch ? categoryMatch[1].trim() : 'عام';
  
  if (amount > 0) {
    const { data, error } = await supabase.from('finance_entries').insert({
      user_id: req.user.id,
      type: 'expense',
      amount: amount,
      category: category,
      note: null,
    }).select().single();
    
    if (!error) {
      actions.push({ tool: 'add_expense', result: `recorded ${amount} (${category})` });
      ruleReply = lang === 'en'
        ? `Recorded expense of ${amount} ${category}, sir.`
        : `تم تسجيل مصروف ${amount} ${category} يا سيدي.`;
    }
  }
}

// 2️⃣ إضافة التزام وقت
else if (msg.includes('add') || msg.includes('سجل') || msg.includes('ضيف')) {
  const hoursMatch = message.match(/(\d+)\s*(hour|h|ساعة)/i);
  const minutesMatch = message.match(/(\d+)\s*(min|m|دقيقة)/i);
  const amountMatch = message.match(/(\d+)\s*(ريال|دولار|r\$|\$)/i);
  
  let hours = 0;
  let title = 'New Commitment';
  
  if (hoursMatch) {
    hours = Number(hoursMatch[1]);
    const titleMatch = message.match(/(?:of|من)\s+(.+)/i) || message.match(/(.+)\s+(?:hour|h|ساعة)/i);
    if (titleMatch) title = titleMatch[1].trim();
  } else if (minutesMatch) {
    hours = Number(minutesMatch[1]) / 60;
    const titleMatch = message.match(/(?:of|من)\s+(.+)/i) || message.match(/(.+)\s+(?:min|m|دقيقة)/i);
    if (titleMatch) title = titleMatch[1].trim();
  }
  
  if (hours > 0) {
    const { data, error } = await supabase.from('commitments').insert({
      user_id: req.user.id,
      title: title,
      hours_per_week: Math.round(hours * 10) / 10,
      type: 'personal',
      intensity: 'medium',
      time_slot: 'mixed',
      flexible: true,
      status: 'active',
    }).select().single();
    
    if (!error) {
      actions.push({ tool: 'add_commitment', result: `added "${data.title}" (${data.hours_per_week}h/week)` });
      ruleReply = lang === 'en'
        ? `Added commitment "${data.title}" for ${data.hours_per_week} hours per week, sir.`
        : `تم إضافة التزام "${data.title}" بمعدل ${data.hours_per_week} ساعات أسبوعياً يا سيدي.`;
    }
  }
}

// 3️ رسالة افتراضية
if (!ruleReply) {
  ruleReply = lang === 'en'
    ? 'I understand your request, sir. My AI engines are momentarily under heavy load, but I\'ve noted your intent and will process it as soon as capacity returns.'
    : 'فهمت طلبك يا سيدي. محركات الذكاء تحت ضغط لحظي، لكنني سجلت نيتك وسأنفذها فور عودة القدرة.';
}

res.json({ reply: ruleReply, actions, engine: 'rules' });

  // استخراج الأوامر من النص
  if (lower.includes('add') || lower.includes('سجل') || lower.includes('ضيف')) {
    // التزام وقت
    const hoursMatch = message.match(/(\d+)\s*(hour|h|ساعة)/i);
    const minutesMatch = message.match(/(\d+)\s*(min|m|دقيقة)/i);
    const hours = hoursMatch ? Number(hoursMatch[1]) : (minutesMatch ? Number(minutesMatch[1]) / 60 : 0);
    
    if (hours > 0) {
      const titleMatch = message.match(/(?:of|من)\s+(.+)/i) || message.match(/(.+)\s+(?:hour|h|ساعة)/i);
      const title = titleMatch ? titleMatch[1].trim() : 'New Commitment';
      
      const { data, error } = await supabase.from('commitments').insert({
        user_id: req.user.id,
        title: title,
        hours_per_week: Math.round(hours * 10) / 10,
        type: 'personal',
        intensity: 'medium',
        time_slot: 'mixed',
        flexible: true,
        status: 'active',
      }).select().single();
      
      if (!error) {
        actions.push({ tool: 'add_commitment', result: `added "${data.title}" (${data.hours_per_week}h/week)` });
        ruleReply = lang === 'en'
          ? `Added commitment "${data.title}" for ${data.hours_per_week} hours per week, sir.`
          : `تم إضافة التزام "${data.title}" بمعدل ${data.hours_per_week} ساعات أسبوعياً يا سيدي.`;
      }
    }
  }

  if (!ruleReply) {
    ruleReply = lang === 'en'
      ? 'I understand your request, sir. My AI engines are momentarily under heavy load, but I\'ve noted your intent and will process it as soon as capacity returns.'
      : 'فهمت طلبك يا سيدي. محركات الذكاء تحت ضغط لحظي، لكنني سجلت نيتك وسأنفذها فور عودة القدرة.';
  }
  
  res.json({ reply: ruleReply, actions, engine: 'rules' });
});

app.get('/api/finance', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('finance_entries').select('*').eq('user_id', req.user.id).order('entry_date', { ascending: false }).limit(50);
    if (error) throw error;
    const list = data || [];
    const income = list.filter((e) => e.type === 'income').reduce((s, e) => s + Number(e.amount), 0);
    const expense = list.filter((e) => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0);
    res.json({ entries: list, summary: { income, expense, balance: income - expense } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/finance', requireAuth, async (req, res) => {
  try {
    const { type, amount, category, note } = req.body || {};
    if (!['income', 'expense'].includes(type)) return res.status(400).json({ error: 'نوع غير صحيح' });
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'مبلغ غير صحيح' });
    const { data, error } = await supabase.from('finance_entries').insert({ user_id: req.user.id, type, amount: amt, category: category || 'other', note: note || null }).select().single();
    if (error) throw error;
    res.json({ entry: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/study', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('study_sessions').select('*').eq('user_id', req.user.id).order('session_date', { ascending: false }).limit(50);
    if (error) throw error;
    const total = (data || []).reduce((s, e) => s + Number(e.duration_minutes), 0);
    res.json({ sessions: data || [], total_minutes: total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/study', requireAuth, async (req, res) => {
  try {
    const { subject, duration_minutes, quality, notes } = req.body || {};
    if (!subject || !subject.trim()) return res.status(400).json({ error: 'المادة مطلوبة' });
    const dur = Number(duration_minutes);
    if (!dur || dur <= 0) return res.status(400).json({ error: 'مدة غير صحيحة' });
    const { data, error } = await supabase.from('study_sessions').insert({ user_id: req.user.id, subject: subject.trim(), duration_minutes: dur, quality: quality || 'medium', notes: notes || null }).select().single();
    if (error) throw error;
    res.json({ session: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/home', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('home_tasks').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ tasks: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/home', requireAuth, async (req, res) => {
  try {
    const { title, room, priority } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: 'العنوان مطلوب' });
    const { data, error } = await supabase.from('home_tasks').insert({ user_id: req.user.id, title: title.trim(), room: room || null, priority: priority || 'medium' }).select().single();
    if (error) throw error;
    res.json({ task: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/home/:id', requireAuth, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['pending', 'in_progress', 'done'].includes(status)) return res.status(400).json({ error: 'حالة غير صحيحة' });
    const { data, error } = await supabase.from('home_tasks').update({ status }).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ task: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/relationships', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('relationships').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ people: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/relationships', requireAuth, async (req, res) => {
  try {
    const { person_name, relation_type, contact_frequency_days, notes } = req.body || {};
    if (!person_name || !person_name.trim()) return res.status(400).json({ error: 'الاسم مطلوب' });
    const { data, error } = await supabase.from('relationships').insert({ user_id: req.user.id, person_name: person_name.trim(), relation_type: relation_type || 'friend', contact_frequency_days: Number(contact_frequency_days) || 7, notes: notes || null }).select().single();
    if (error) throw error;
    res.json({ person: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wellness', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('wellness_logs').select('*').eq('user_id', req.user.id).order('log_date', { ascending: false }).limit(30);
    if (error) throw error;
    res.json({ logs: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wellness', requireAuth, async (req, res) => {
  try {
    const { mood, energy, sleep_hours, exercise_minutes, note } = req.body || {};
    const { data, error } = await supabase.from('wellness_logs').insert({ user_id: req.user.id, mood: Number(mood) || 5, energy: Number(energy) || 5, sleep_hours: Number(sleep_hours) || null, exercise_minutes: Number(exercise_minutes) || 0, note: note || null }).select().single();
    if (error) throw error;
    res.json({ log: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));