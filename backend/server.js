import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AGENT_TOOLS, getOpenAITools, runAgentTool } from './agent-tools.js';

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

// 1️⃣ المفاتيح والموديلات مرتبة حسب الأولوية
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || '';
const CEREBRAS_MODEL = 'llama-3.3-70b';

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = 'llama-3.1-70b-versatile';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL_FALLBACKS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

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
أنت في محادثة حية وتحليلية عميقة. قواعد الرد:
- استخدم معطيات ملف القضية الحقيقية (التزامات، مقاييس، ذاكرة، ملف الحياة) في ردودك بدقة.
- أجب بأسلوب خطابي ذكي، فصيح، وهادئ (من 2 إلى 5 جمل).
- استنتج، لاحظ، وحلل بذكاء شارلوك هولمز.
- لا تخترع أرقامًا غير موجودة في السياق.
- أجب بنص عادي فقط بدون JSON وبدون عناوين جانبية.`;

function normalizeCommitment(row) {
  return {
    id: row.id,
    title: row.title,
    hours_per_week: Math.round(Number(row.hours_per_week || 0) * 10) / 10,
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

// 🌐 1. Cerebras Chat Helper (الأول والأساسي)
async function cerebrasChat(system, messages, tools = null) {
  if (!CEREBRAS_API_KEY) throw new Error('CEREBRAS_API_KEY missing');
  const body = {
    model: CEREBRAS_MODEL,
    temperature: 0.7,
    messages: [{ role: 'system', content: system }, ...messages],
  };
  if (tools) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CEREBRAS_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Cerebras ' + response.status);
  return await response.json();
}

// 🌐 2. Groq Chat Helper (الثاني الاحتياطي)
async function groqChat(system, messages, tools = null) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');
  const body = {
    model: GROQ_MODEL,
    temperature: 0.7,
    messages: [{ role: 'system', content: system }, ...messages],
  };
  if (tools) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Groq ' + response.status);
  return await response.json();
}

// 🌐 3. Gemini Helper (الثالث والأخير)
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
      finance: { income, expense, balance: income - expense, entries: finList },
      study: { total_minutes: (stu.data || []).reduce((s, e) => s + Number(e.duration_minutes), 0) },
      home: { pending_tasks: (home.data || []).filter((t) => t.status !== 'done').length },
      relationships: { count: (rel.data || []).length },
      wellness: (well.data || [])[0] || null,
    };
  } catch (e) {
    return null;
  }
}

// دالة تحليل المخاطر الذكية (Cerebras → Groq → Gemini)
async function askBaseerBrain(evidence, lang = 'ar') {
  const langNote = lang === 'en' ? '\nIMPORTANT: Respond FULLY in English, JARVIS style, address the user as "sir". Keep the same JSON keys.' : '\nأسلوب الكلام: خاطب المستخدم بلقب "سيدي"، بأسلوب جارفس.';
  const systemPrompt = BASEER_PERSONA + langNote;
  const userMsg = JSON.stringify(evidence, null, 2);

  // 1️⃣ Cerebras
  if (CEREBRAS_API_KEY) {
    try {
      const data = await cerebrasChat(systemPrompt, [{ role: 'user', content: userMsg }]);
      const text = data.choices?.[0]?.message?.content || '';
      console.log('🧠 عَقْل فكر عبر Cerebras');
      return parseBrainJson(text);
    } catch (err) {
      console.log('🧠 Cerebras brain failed, trying Groq:', err.message);
    }
  }

  // 2️⃣ Groq
  if (GROQ_API_KEY) {
    try {
      const data = await groqChat(systemPrompt, [{ role: 'user', content: userMsg }]);
      const text = data.choices?.[0]?.message?.content || '';
      console.log('🧠 عَقْل فكر عبر Groq');
      return parseBrainJson(text);
    } catch (e) {
      console.log('🧠 Groq brain failed, trying Gemini:', e.message);
    }
  }

  // 3️⃣ Gemini
  try {
    const data = await geminiGenerate({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      generationConfig: { temperature: 0.9 },
    });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('🧠 عَقْل فكر عبر Gemini');
    return parseBrainJson(text);
  } catch (err) {
    console.log('🧠 Gemini brain failed:', err.message);
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

// ----------------------------------------------------
// Endpoints
// ----------------------------------------------------

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
    const projectedTotal = Math.round((currentHours + addedHours) * 10) / 10;
    const remainingHours = Math.round((168 - projectedTotal) * 10) / 10;
    const highHours = currentCommitments.filter((c) => c.intensity === 'high').reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
    const rigidHours = currentCommitments.filter((c) => !c.flexible).reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
    const lateHours = currentCommitments.filter((c) => c.timeSlot === 'late_night').reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
    
    const { data: memory } = await supabase.from('analysis_logs').select('burnout_risk, main_insight').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(3);
    const life = await fetchLifeData(req.user.id);
    
    const evidence = {
      current_commitments: currentCommitments,
      new_commitment: newCommitment,
      metrics: { current_hours: Math.round(currentHours * 10) / 10, added_hours: addedHours, projected_total: projectedTotal, remaining_hours: remainingHours, high_intensity_hours: highHours, rigid_hours: rigidHours, late_night_hours: lateHours },
      history: memory || [],
      life: life || null,
    };

    let brain = await askBaseerBrain(evidence, lang);

    const simulationResults = {
      current_hours: Math.round(currentHours * 10) / 10,
      added_hours: addedHours,
      projected_total: projectedTotal,
      remaining_hours: remainingHours,
      burnout_risk: brain.burnout_risk || 'Medium',
      main_insight: brain.main_insight || '',
      detective_question: brain.detective_question || '',
      recommendation: brain.recommendation || '',
      deductions: brain.deductions || [],
      thinking_source: 'ai',
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

// 💬 مسار الدردشة الذكي (Cerebras ← Groq ← Gemini) بدون أي شروط ثابتة
app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const message = (body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'اكتب رسالتك أولاً' });
    
    const lang = body.lang === 'en' ? 'en' : 'ar';
    const { data: commitments } = await supabase.from('commitments').select('*').eq('user_id', req.user.id).eq('status', 'active');
    const list = (commitments || []).map(normalizeCommitment);
    const totalHours = Math.round(list.reduce((s, c) => s + Number(c.hours_per_week || 0), 0) * 10) / 10;
    const life = await fetchLifeData(req.user.id);
    
    const { data: historyData } = await supabase.from('chat_messages').select('role, content').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(10);
    const history = (historyData || []).reverse();

    const systemPrompt = CHAT_PERSONA + (lang === 'en' ? '\nRespond in English, address the user as "sir".' : '\nخاطب المستخدم بلقب "سيدي".')
      + `\nCurrent Case Data:\n- Commitments: ${JSON.stringify(list)}\n- Total Weekly Hours: ${totalHours}h\n- Life & Finance Summary: ${JSON.stringify(life)}`;

    const messagesPayload = [
      ...history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
      { role: 'user', content: message }
    ];

    let reply = '';

    // 1️⃣ Cerebras
    if (CEREBRAS_API_KEY) {
      try {
        const data = await cerebrasChat(systemPrompt, messagesPayload);
        reply = data.choices?.[0]?.message?.content || '';
        if (reply.trim()) console.log('💬 Chat via Cerebras');
      } catch (err) {
        console.log('💬 Cerebras chat failed, sliding to Groq:', err.message);
      }
    }

    // 2️⃣ Groq
    if (!reply && GROQ_API_KEY) {
      try {
        const data = await groqChat(systemPrompt, messagesPayload);
        reply = data.choices?.[0]?.message?.content || '';
        if (reply.trim()) console.log('💬 Chat via Groq');
      } catch (err) {
        console.log('💬 Groq chat failed, sliding to Gemini:', err.message);
      }
    }

    // 3️⃣ Gemini
    if (!reply) {
      try {
        console.log('💬 Trying Gemini...');
        // دمج السياق مع رسالة المستخدم في حزمة واحدة لتجنب خطأ تعاقب الأدوار في Gemini
        const safeMessage = `System Info:\n${systemPrompt}\n\nUser Message:\n${message}`;
        
        const geminiContents = [
          ...history.map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] })),
          { role: 'user', parts: [{ text: safeMessage }] }
        ];

        // تنظيف الـ history في حال كان هناك رسالتين متتاليتين لنفس الدور (لتجنب Crash)
        const cleanedContents = geminiContents.filter((msg, index, arr) => {
          if (index === 0) return true;
          return msg.role !== arr[index - 1].role;
        });

        const data = await geminiGenerate({
          system_instruction: { parts: [{ text: CHAT_PERSONA }] },
          contents: cleanedContents,
          generationConfig: { temperature: 0.8 },
        });
        reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (reply.trim()) console.log('💬 Chat via Gemini');
      } catch (err) {
        console.error('💬 Gemini chat failed:', err.message);
      }
    }

    if (!reply) {
      reply = lang === 'en'
        ? 'Pardon me, sir — my thinking engines are momentarily offline.'
        : 'عذرًا سيدي — محركات التفكير تشهد انقطاعاً لحظياً.';
    }

    await supabase.from('chat_messages').insert([
      { user_id: req.user.id, role: 'user', content: message },
      { user_id: req.user.id, role: 'assistant', content: reply },
    ]);
    
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/directive', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const lang = body.lang === 'en' ? 'en' : 'ar';
    const { data: commitments } = await supabase.from('commitments').select('*').eq('user_id', req.user.id).eq('status', 'active');
    const list = (commitments || []).map(normalizeCommitment);
    const totalHours = Math.round(list.reduce((s, c) => s + Number(c.hours_per_week || 0), 0) * 10) / 10;
    const prompt = lang === 'en' ? `You are AQL, a JARVIS-style mind; address the user as "sir". Build today's operational directive. Modules: ${JSON.stringify(list)}. Weekly total: ${totalHours}h. Return JSON only: {"slots":[{"time":"06:00-09:00","task":"...","tag":"deep|meeting|rest|warn"}],"closing":"one JARVIS-style line"}` : `أنت "عَقْل" بأسلوب جارفس، تخاطب المستخدم بلقب "سيدي". ابنِ توجيه اليوم التشغيلي بناءً على التزاماته: ${JSON.stringify(list)}. الإجمالي الأسبوعي: ${totalHours} ساعة. أرجع JSON فقط بالشكل: {"slots":[{"time":"06:00-09:00","task":"...","tag":"deep|meeting|rest|warn"}],"closing":"جملة ختامية بأسلوب جارفس"}`;
    
    let result = null;

    // 1️⃣ Cerebras
    if (CEREBRAS_API_KEY) {
      try {
        const data = await cerebrasChat('Return JSON only.', [{ role: 'user', content: prompt }]);
        result = parseBrainJson(data.choices?.[0]?.message?.content || '');
      } catch (e) {}
    }
    // 2️⃣ Groq
    if (!result && GROQ_API_KEY) {
      try {
        const data = await groqChat('Return JSON only.', [{ role: 'user', content: prompt }]);
        result = parseBrainJson(data.choices?.[0]?.message?.content || '');
      } catch (e) {}
    }
    // 3️⃣ Gemini
    if (!result) {
      try {
        const data = await geminiGenerate({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8 } });
        result = parseBrainJson(data.candidates?.[0]?.content?.parts?.[0]?.text || '');
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

// 🤖 مسار الوكيل التفاعلي (Cerebras ← Groq ← Gemini) تنفيذ أدوات بنسبة 100% بدون قواعد تقليدية
app.post('/api/agent', requireAuth, async (req, res) => {
  const body = req.body || {};
  const message = (body.message || '').trim();
  const lang = body.lang === 'en' ? 'en' : 'ar';
  
  if (!message) return res.status(400).json({ error: 'No message' });

  const { data: commitments } = await supabase.from('commitments').select('*').eq('user_id', req.user.id).eq('status', 'active');
  const list = (commitments || []).map(normalizeCommitment);
  const totalHours = Math.round(list.reduce((s, c) => s + Number(c.hours_per_week || 0), 0) * 10) / 10;
  const life = await fetchLifeData(req.user.id);
  
  const system = CHAT_PERSONA + (lang === 'en' ? '\nRespond in English, address the user as "sir".' : '\nخاطب المستخدم بلقب "سيدي".')
    + `\nCurrent System Data:\n- Commitments: ${JSON.stringify(list)}\n- Total Weekly Hours: ${totalHours}h\n- Life & Finance Data: ${JSON.stringify(life)}`;

  const openAiTools = getOpenAITools();
  const actions = [];
  let reply = '';

  // === 🥇 الطبقة الأولى: Cerebras ===
  if (CEREBRAS_API_KEY) {
    try {
      console.log('🤖 Agent: Trying Cerebras...');
      let messages = [{ role: 'user', content: message }];
      for (let step = 0; step < 6; step++) {
        const data = await cerebrasChat(system, messages, openAiTools);
        const msg = data.choices?.[0]?.message;
        const tc = msg?.tool_calls?.[0];
        if (tc) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
          const result = await runAgentTool(req.user.id, tc.function.name, args, { supabase });
          actions.push({ tool: tc.function.name, result });
          messages.push({ role: 'assistant', content: null, tool_calls: msg.tool_calls });
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          continue;
        }
        reply = msg?.content || '';
        break;
      }
      if (reply || actions.length) {
        console.log('✅ Agent: Cerebras succeeded');
        return res.json({ reply: reply || (lang === 'en' ? 'Done, sir.' : 'تم التنفيذ يا سيدي.'), actions, engine: 'cerebras' });
      }
    } catch (cErr) {
      console.log('⚠️ Cerebras agent failed, sliding to Groq:', cErr.message);
    }
  }

  // === 🥈 الطبقة الثانية: Groq ===
  if (GROQ_API_KEY) {
    try {
      console.log('🤖 Agent: Trying Groq...');
      let messages = [{ role: 'user', content: message }];
      for (let step = 0; step < 6; step++) {
        const data = await groqChat(system, messages, openAiTools);
        const msg = data.choices?.[0]?.message;
        const tc = msg?.tool_calls?.[0];
        if (tc) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
          const result = await runAgentTool(req.user.id, tc.function.name, args, { supabase });
          actions.push({ tool: tc.function.name, result });
          messages.push({ role: 'assistant', content: null, tool_calls: msg.tool_calls });
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          continue;
        }
        reply = msg?.content || '';
        break;
      }
      if (reply || actions.length) {
        console.log('✅ Agent: Groq succeeded');
        return res.json({ reply: reply || (lang === 'en' ? 'Done, sir.' : 'تم التنفيذ يا سيدي.'), actions, engine: 'groq' });
      }
    } catch (gErr) {
      console.log('⚠️ Groq agent failed, sliding to Gemini:', gErr.message);
    }
  }

  // === 🥉 الطبقة الثالثة: Gemini ===
  try {
    console.log('🤖 Agent: Trying Gemini...');
    const contents = [{ role: 'user', parts: [{ text: message }] }];
    for (let step = 0; step < 6; step++) {
      const data = await geminiGenerate({
        system_instruction: { parts: [{ text: system }] },
        contents,
        tools: [{ function_declarations: AGENT_TOOLS }],
      });
      const part = data.candidates?.[0]?.content?.parts?.[0];
      const fc = part?.functionCall;
      if (fc) {
        const result = await runAgentTool(req.user.id, fc.name, fc.args || {}, { supabase });
        actions.push({ tool: fc.name, result });
        contents.push({ role: 'model', parts: [{ functionCall: fc }] });
        contents.push({ role: 'user', parts: [{ functionResponse: { name: fc.name, response: { result } } }] });
        continue;
      }
      reply = part?.text || '';
      break;
    }
    if (reply || actions.length) {
      console.log('✅ Agent: Gemini succeeded');
      return res.json({ reply: reply || (lang === 'en' ? 'Done, sir.' : 'تم التنفيذ يا سيدي.'), actions, engine: 'gemini' });
    }
  } catch (gemErr) {
    console.log('❌ Gemini agent failed:', gemErr.message);
  }

  // ⚠️ بروتوكول الطوارئ لو انقطعت كل المزودات السحابية
  const emergencyReply = lang === 'en'
    ? 'Pardon me, sir — all cognitive engines are momentarily unreachable. Standing by for reconnection.'
    : 'عذرًا سيدي — محركات التفكير السحابية تشهد انقطاعاً لحظياً. في انتظار إعادة الاتصال.';
  
  res.status(503).json({ reply: emergencyReply, actions: [], engine: 'emergency' });
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