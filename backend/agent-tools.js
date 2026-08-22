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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL_FALLBACKS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

// مفاتيح النماذج السريعة والذكية
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || '';
const CEREBRAS_MODEL = 'llama-3.3-70b';

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = 'llama-3.1-8b-instant';

const CHAT_PERSONA = `أنت "عَقْل"، المحقق السلوكي الذكي في نظام AQL-OS لتوازن الحياة، بأسلوب جارفس: خاطب المستخدم بلقب "سيدي".
أنت في محادثة حية وتحليلية عميقة. قواعد الرد:
- استخدم معطيات ملف القضية الحقيقية (التزامات، مقاييس، ذاكرة، ملف الحياة) في ردودك بدقة.
- أجب بأسلوب خطابي ذكي، فصيح، وهادئ.
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

// دالة الاتصال بـ Cerebras (متوافقة مع OpenAI API)
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

// دالة الاتصال بـ Groq
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

// مسار الوكيل الذكي بالكامل (بدون أي قواعد تقليدية، اعتماداً حصرياً على سلسلة النماذج الذكية)
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

  // === الطبقة الأولى: Gemini مع Function Calling ===
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
    console.log('⚠️ Gemini agent failed, sliding to Cerebras:', gemErr.message);
  }

  // === الطبقة الثانية: Cerebras (سريع جداً وعالي الذكاء) ===
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

  // === الطبقة الثالثة: Groq (احتياطي سريع) ===
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
      console.log('❌ Groq agent failed:', gErr.message);
    }
  }

  // === بروتوكول الطوارئ (لو تعطلت كل العقول السحابية مؤقتاً) ===
  const emergencyReply = lang === 'en'
    ? 'Pardon me, sir — all cognitive engines are momentarily unreachable. Standing by for reconnection.'
    : 'عذرًا سيدي — محركات التفكير السحابية تشهد انقطاعاً لحظياً. في انتظار إعادة الاتصال.';
  
  res.status(503).json({ reply: emergencyReply, actions: [], engine: 'emergency' });
});

// باقي المسارات تبقى كما هي...
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));


export const AGENT_TOOLS = toolsRegistry.map(t => t.declaration);

export const getOpenAITools = () => toolsRegistry.map(tool => ({
  type: 'function',
  function: {
    name: tool.declaration.name,
    description: tool.declaration.description,
    parameters: {
      type: 'object',
      properties: tool.declaration.parameters.properties,
      required: tool.declaration.parameters.required || [],
    },
  },
}));

export const runAgentTool = async (userId, name, args, context) => {
  const tool = toolsRegistry.find(t => t.declaration.name === name);
  if (!tool) return `unknown tool ${name}`;
  try {
    return await tool.execute(userId, args, context);
  } catch (e) {
    return `tool ${name} failed: ${e.message}`;
  }
};