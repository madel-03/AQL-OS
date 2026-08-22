import { useState, useEffect, useCallback } from 'react';
import { supabase } from './lib/supabase';
import { LangProvider } from './lib/i18n';
import { useLang } from './lib/lang';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const emptyCommitment = { title: '', hours_per_week: 10, type: 'personal', intensity: 'medium', timeSlot: 'morning', flexible: true };
const typeLabels = { study: 'دراسة', work: 'عمل', health: 'صحة', personal: 'شخصي', sleep: 'نوم' };
const typeColors = { study: '#38bdf8', work: '#f59e0b', health: '#10b981', personal: '#c084fc', sleep: '#64748b' };
const slotLabels = { morning: 'صباحي', afternoon: 'ظهراً', evening: 'مسائي', late_night: 'ليل متأخر', mixed: 'مختلط' };
const labelStyle = { display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '6px' };
const fieldStyle = { width: '100%', padding: '10px 14px', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: '#fff', boxSizing: 'border-box' };

const NAV_ITEMS = [
  { id: 'dashboard', icon: '🧠', label: 'غرفة الوعي' },
  { id: 'investigate', icon: '⌖', label: 'غرفة التحليل' },
  { id: 'commitments', icon: '≣', label: 'وحدات الوقت' },
  { id: 'history', icon: '▤', label: 'سجل التحليلات' },
  { id: 'goals', icon: '◉', label: 'الأهداف الاستراتيجية' },
  { id: 'reports', icon: '▥', label: 'التقارير الحيوية' },
  { id: 'chat', icon: '✦', label: 'اتصال مباشر' },
  { id: 'achievements', icon: '▲', label: 'شارات الأداء' },
  { id: 'profile', icon: '⬡', label: 'الهوية' },
  { id: 'lifeos', icon: '🧬', label: 'Life OS' },
];

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` };
}

const barWidth = (hours) => `${Math.max(0, Math.min((hours / 168) * 100, 100))}%`;
function prettyAction(result) {
  const m = String(result || '').match(/RESULTS: (\[[\s\S]*\])$/);
  if (m) {
    try { return JSON.parse(m[1]).slice(0, 3).map((r) => '• ' + r.title).join('   '); } catch (e) { /* نتجاهل */ }
  }
  return String(result || '');
}
function riskOf(totalHours) {
  if (totalHours > 110) return { label: 'Critical', color: '#ef4444' };
  if (totalHours > 90) return { label: 'High', color: '#f59e0b' };
  if (totalHours > 75) return { label: 'Medium', color: '#f59e0b' };
  return { label: 'Low', color: '#10b981' };
}

/* ========== محرك صوت جارفس (Edge Neural) ========== */
let jarvisAudio = null;
let jarvisSession = 0;
let lastGreetAt = 0;

function b64ToBlob(base64, type) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

function pcmToWav(base64, sampleRate) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const buffer = new ArrayBuffer(44 + bytes.length);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + bytes.length, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, 'data'); view.setUint32(40, bytes.length, true);
  new Uint8Array(buffer, 44).set(bytes);
  return new Blob([buffer], { type: 'audio/wav' });
}

function jarvisStop() {
  jarvisSession++;
  if (jarvisAudio) { jarvisAudio.pause(); jarvisAudio = null; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function chunkText(text, max = 400) {
  const sentences = text.match(/[^.!؟?\n]+[.!؟?]*/g) || [text];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > max && cur) { chunks.push(cur); cur = s; }
    else cur += s;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function voiceSummary(text) {
  const sentences = String(text || '').match(/[^.!؟?\n]+[.!؟?]*/g) || [text];
  let out = '';
  for (const s of sentences) {
    if ((out + s).length > 260) break;
    out += s;
  }
  return out || String(text || '').slice(0, 260);
}

function playChunkLocal(chunk, lang) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    const parts = chunk.match(/[^.!؟?\n]+[.!؟?]*/g) || [chunk];
    let done = 0;
    const resumeTimer = setInterval(() => {
      if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
    }, 8000);
    const finish = () => {
      done++;
      if (done === parts.length) { clearInterval(resumeTimer); resolve(); }
    };
    parts.forEach((p) => {
      const u = new SpeechSynthesisUtterance(p.trim());
      u.pitch = 0.75; u.rate = 0.95;
      u.lang = lang === 'ar' ? 'ar-SA' : 'en-GB';
      u.onend = u.onerror = finish;
      window.speechSynthesis.speak(u);
    });
  });
}

async function playChunkTTS(chunk, lang, voice) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const headers = await getAuthHeaders();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(`${API_URL}/api/tts`, {
        method: 'POST', headers, signal: ctrl.signal,
        body: JSON.stringify({ text: chunk, lang, voice }),
      });
      clearTimeout(timer);
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      const json = await res.json();
      if (!res.ok || !json.audio) return false;
      const isMpeg = (json.mime || '').includes('mpeg');
      const url = URL.createObjectURL(isMpeg ? b64ToBlob(json.audio, 'audio/mpeg') : pcmToWav(json.audio, Number(((json.mime || '').match(/rate=(\d+)/) || [])[1] || 24000)));
      const ok = await new Promise((resolve) => {
        jarvisAudio = new Audio(url);
        jarvisAudio.onended = () => resolve(true);
        jarvisAudio.onerror = () => resolve(false);
        jarvisAudio.play().catch(() => resolve(false));
      });
      jarvisAudio = null;
      URL.revokeObjectURL(url);
      return ok;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return false;
}

function jarvisSpeak(text, lang, onEnd, voice) {
  jarvisStop();
  const my = jarvisSession;
  (async () => {
    const chunks = chunkText(voiceSummary(text), 400);
    for (const chunk of chunks) {
      if (my !== jarvisSession) return;
      const ok = await playChunkTTS(chunk, lang, voice);
      if (my !== jarvisSession) return;
      if (!ok) await playChunkLocal(chunk, lang);
      if (my !== jarvisSession) return;
    }
    if (my === jarvisSession) onEnd && onEnd();
  })();
}

/* ========== لوحات العقل ========== */
function BrainPanels({ result }) {
  if (!result) return null;
  const isGemini = result.thinking_source === 'gemini';
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span style={{ padding: '7px 14px', borderRadius: '999px', border: isGemini ? '1px solid rgba(139,92,246,0.35)' : '1px solid rgba(148,163,184,0.25)', background: isGemini ? 'rgba(139,92,246,0.12)' : 'rgba(148,163,184,0.08)', color: isGemini ? '#c4b5fd' : '#94a3b8', fontSize: '0.8rem', fontWeight: 800 }}>
          {isGemini ? '🧠 عَقْل يفكر عبر Gemini' : '⚙️ محرك القواعد (AI غير متصل)'}
        </span>
      </div>
      {result.detective_question && (
        <div className="glass-panel deduction-panel" style={{ padding: '1.8rem' }}>
          <h4 style={{ marginTop: 0, color: '#c4b5fd', fontSize: '1.15rem' }}>🕵️ سؤال المحقق:</h4>
          <p style={{ margin: 0, fontSize: '1.1rem', lineHeight: 1.8, color: '#e2e8f0', fontStyle: 'italic' }}>"{result.detective_question}"</p>
        </div>
      )}
      {result.recommendation && (
        <div className="glass-panel hud-panel" style={{ padding: '1.8rem' }}>
          <h4 style={{ marginTop: 0, color: '#38bdf8', fontSize: '1.15rem' }}>🧭 توصية عَقْل التنفيذية:</h4>
          <p style={{ margin: 0, fontSize: '1.05rem', lineHeight: 1.8, color: '#e2e8f0' }}>{result.recommendation}</p>
        </div>
      )}
    </>
  );
}
/* ========== زر اللغة العائم (قبل الدخول) ========== */
function FloatingLangButton() {
  const { lang, setLang } = useLang();
  return (
    <button
      onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
      style={{
        position: 'fixed', top: '18px', right: '18px', zIndex: 50,
        background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.35)',
        color: '#7dd3fc', borderRadius: '999px', padding: '8px 18px',
        cursor: 'pointer', fontSize: '0.85rem', fontWeight: '700', backdropFilter: 'blur(8px)',
      }}
    >
      ◐ {lang === 'ar' ? 'EN' : 'AR'}
    </button>
  );
}

/* ========== شاشة الدخول ========== */
function AuthScreen() {
  const { lang, t } = useLang();
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState('');

  const box = (kind) => ({
    background: kind === 'err' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
    border: `1px solid ${kind === 'err' ? 'rgba(239,68,68,0.4)' : 'rgba(16,185,129,0.4)'}`,
    color: kind === 'err' ? '#fecaca' : '#bbf7d0',
    borderRadius: '10px', padding: '0.8rem 1rem', marginBottom: '1rem', fontSize: '0.9rem',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
        if (error) throw error;
        if (!data.session) { setOtpStep(true); setMessage(`📬 أرسلنا رمز تفعيل مكونًا من 6 أرقام إلى: ${email}`); }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: otp.trim(), type: 'signup' });
      if (error) throw error;
      setMessage('✅ تم تفعيل الحساب! جاري تسجيل الدخول...');
    } catch (err) { setError('الرمز غير صحيح أو منتهي الصلاحية، حاول مجددًا.'); } finally { setBusy(false); }
  };

  const resendOtp = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
      setMessage('📬 تمت إعادة إرسال رمز جديد.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  if (otpStep) {
    return (
      <div className="app-shell" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', direction: dir }}>
        <div className="glass-panel hud-panel" style={{ padding: '2.2rem', width: '100%', maxWidth: '430px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', marginBottom: '1.4rem' }}>
            <div className="baseer-avatar"><span className="baseer-icon">📬</span></div>
            <h2 style={{ margin: 0, color: '#f8fafc' }}>{t('أدخل رمز التفعيل')}</h2>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>{t('أرسلنا رمزًا مكونًا من 6 أرقام إلى بريدك')}</p>
          </div>
          {error && <div style={box('err')}>⚠️ {error}</div>}
          {message && <div style={box('ok')}>{message}</div>}
          <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="——————"
              style={{ ...fieldStyle, textAlign: 'center', letterSpacing: '10px', fontSize: '1.4rem', fontWeight: 800 }} />
            <button type="submit" disabled={busy || otp.length !== 6} style={{ padding: '13px', background: 'linear-gradient(90deg,#059669,#10b981)', color: 'white', border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: '700', cursor: busy || otp.length !== 6 ? 'not-allowed' : 'pointer', opacity: otp.length !== 6 ? 0.6 : 1 }}>
              {busy ? t('⏳ جاري التحقق...') : t('✅ تفعيل الحساب')}
            </button>
          </form>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.2rem' }}>
            <button onClick={resendOtp} disabled={busy} style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', fontWeight: '700', fontSize: '0.9rem', padding: 0 }}>{t('📬 إعادة إرسال الرمز')}</button>
            <button onClick={() => { setOtpStep(false); setOtp(''); setError(''); setMessage(''); }} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontWeight: '700', fontSize: '0.9rem', padding: 0 }}>{t('← رجوع')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', direction: dir }}>
      <div className="glass-panel hud-panel" style={{ padding: '2.2rem', width: '100%', maxWidth: '430px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', marginBottom: '1.4rem' }}>
          <div className="baseer-avatar"><span className="baseer-icon">🧠</span></div>
          <h2 style={{ margin: 0, color: '#f8fafc', fontFamily: 'Orbitron, Tajawal' }}>عَقْل | AQL-OS</h2>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>
            {mode === 'login' ? t('سجّل دخولك لفتح ملف القضية الخاص بك') : t('أنشئ حسابك وابدأ تحقيقك الأول')}
          </p>
        </div>
        {error && <div style={box('err')}>⚠️ {error}</div>}
        {message && <div style={box('ok')}>{message}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {mode === 'signup' && (
            <div><label style={labelStyle}>{t('الاسم الكامل')}</label>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} style={fieldStyle} placeholder="اسمك" /></div>
          )}
          <div><label style={labelStyle}>{t('البريد الإلكتروني')}</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={fieldStyle} placeholder="you@example.com" /></div>
          <div><label style={labelStyle}>{t('كلمة المرور')}</label>
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} style={fieldStyle} placeholder="••••••••" /></div>
          <button type="submit" disabled={busy} style={{ padding: '13px', background: 'linear-gradient(90deg,#0284c7,#6366f1)', color: 'white', border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: '700', cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? t('⏳ لحظة...') : mode === 'login' ? t('🔓 تسجيل الدخول') : t('🧾 إنشاء حساب')}
          </button>
        </form>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem', textAlign: 'center', marginTop: '1.2rem', marginBottom: 0 }}>
          {mode === 'login' ? t('ما عندك حساب؟') : t('عندك حساب بالفعل؟')}{' '}
          <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage(''); }}
            style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', fontWeight: '700', fontSize: '0.9rem', padding: 0 }}>
            {mode === 'login' ? t('أنشئ حسابًا') : t('سجّل الدخول')}
          </button>
        </p>
      </div>
    </div>
  );
}

/* ========== أيقونات الخط الرفيع (1px) — نفس روح الرادار ========== */
function NavIcon({ id }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (id) {
    case 'dashboard': return <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" /><path d="M12 3.5V6M12 18v2.5M3.5 12H6M18 12h2.5" /></svg>;
    case 'investigate': return <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="7" /><path d="M12 2.5V7M12 17v4.5M2.5 12H7M17 12h4.5" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /></svg>;
    case 'commitments': return <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></svg>;
    case 'history': return <svg viewBox="0 0 24 24" {...p}><rect x="5" y="3.5" width="14" height="17" rx="1" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4.5" /></svg>;
    case 'goals': return <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /></svg>;
    case 'reports': return <svg viewBox="0 0 24 24" {...p}><path d="M5.5 19.5v-7M10 19.5v-13M14.5 19.5v-9M19 19.5v-11" /></svg>;
    case 'chat': return <svg viewBox="0 0 24 24" {...p}><path d="M12 3l2.1 6.9L21 12l-6.9 2.1L12 21l-2.1-6.9L3 12l6.9-2.1z" /></svg>;
    case 'achievements': return <svg viewBox="0 0 24 24" {...p}><path d="M12 4l8 16H4z" /><path d="M12 10.5l3.2 6.5H8.8z" /></svg>;
    case 'profile': return <svg viewBox="0 0 24 24" {...p}><path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'lifeos': return <svg viewBox="0 0 24 24" {...p}><path d="M8 3c0 6 8 6 8 12 0 3-1.5 4.5-4 6" /><path d="M16 3c0 6-8 6-8 12 0 3 1.5 4.5 4 6" /><path d="M9.5 7.5h5M9.5 12h5M9.5 16.5h5" /></svg>;
    default: return null;
  }
}

/* ========== الهيكل ========== */
function Layout({ page, setPage, displayName, onLogout, children }) {
  const { lang, setLang, t } = useLang();
  const [railOpen, setRailOpen] = useState(false);
  const current = NAV_ITEMS.find((n) => n.id === page);
  return (
    <div className="app-shell app-layout" style={{ minHeight: '100vh', direction: lang === 'ar' ? 'rtl' : 'ltr', display: 'flex' }}>
      <aside className={`app-sidebar rail ${railOpen ? 'rail-open' : ''}`}>
        <div className="rail-scan" aria-hidden="true" />
        <div className="rail-logo" onClick={() => setRailOpen(!railOpen)}>
          <div className="baseer-avatar" style={{ width: '40px', height: '40px' }}><span style={{ fontSize: '1.05rem' }}>🧠</span></div>
          <div className="rail-logo-text">
            <div style={{ color: 'var(--cyan)', fontWeight: 800, fontFamily: 'Orbitron, Tajawal', letterSpacing: '0.15em' }}>{lang === 'ar' ? 'عَقْل' : 'AQL'}</div>
            <div className="mono" style={{ color: 'var(--muted)', fontSize: '0.58rem', letterSpacing: '3px' }}>AQL-OS v3</div>
          </div>
        </div>
        {NAV_ITEMS.map((item) => (
          <button key={item.id} className={`nav-btn ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)} title={t(item.label)}>
            <span className="nav-icon"><NavIcon id={item.id} /></span>
            <span className="nav-label">{t(item.label)}</span>
          </button>
        ))}
      </aside>
      <div style={{ flex: 1, minWidth: 0, padding: '1.8rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.4rem' }}>
          <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.6rem', fontWeight: 800 }}>
            <span className="title-icon"><NavIcon id={page} /></span> {t(current?.label)}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} style={{ background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.3)', color: '#7dd3fc', borderRadius: '999px', padding: '6px 14px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '700' }}>◐ {lang === 'ar' ? 'EN' : 'AR'}</button>
            <span className="hud-chip violet">🕵️ {displayName}</span>
            <button onClick={onLogout} style={{ background: 'rgba(255,77,77,0.08)', border: '1px solid rgba(255,77,77,0.35)', color: '#ffb3b3', borderRadius: '999px', padding: '6px 14px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '700' }}>{t('فصل')} ⏻</button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function BrainCore({ riskL = 'Low', load = 0.3, rest = 0.7, thinking = false }) {
  const rgb = riskL === 'Critical' || riskL === 'High' ? '255,77,77' : riskL === 'Medium' ? '255,176,32' : '0,229,255';
  const speed = (0.6 + load * 1.8) * (thinking ? 3 : 1);
  useEffect(() => {
    const canvas = document.getElementById('brain-core');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = (canvas.width = 420); const H = (canvas.height = 420);
    const cx = W / 2, cy = H / 2, R = 150;
    const dots = Array.from({ length: 380 }, () => ({
      a: Math.random() * Math.PI * 2, r: Math.sqrt(Math.random()) * R,
      s: Math.random() * 1.6 + 0.4, tw: Math.random() * Math.PI * 2, sp: 0.002 + Math.random() * 0.004,
    }));
    let raf;
    const draw = (t) => {
      ctx.clearRect(0, 0, W, H);
      for (const d of dots) {
        d.a += d.sp * speed;
        const x = cx + Math.cos(d.a) * d.r;
        const y = cy + Math.sin(d.a) * d.r * 0.92;
        const alpha = 0.3 + 0.7 * Math.abs(Math.sin(t / 700 + d.tw));
        ctx.beginPath(); ctx.arc(x, y, d.s, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb}, ${alpha})`; ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [rgb, speed]);
  return (
    <div className={thinking ? 'core-wrap thinking' : 'core-wrap'} style={{ position: 'relative', width: '420px', height: '420px', margin: '0 auto 0.5rem', maxWidth: '100%' }}>
      <canvas id="brain-core" style={{ position: 'absolute', inset: 0 }} />
      <div className="radar-sweep" />
      <div className="jarvis-ring r1" style={{ animationDuration: `${26 - load * 14}s`, borderColor: `rgba(${rgb},0.55)` }} />
      <div className="jarvis-ring r2" style={{ animationDuration: `${16 - load * 8}s`, borderColor: `rgba(${rgb},0.4)` }} />
      <div className="jarvis-ring r3" style={{ animationDuration: `${5 - rest * 2}s` }} />
    </div>
  );
}

/* ========== أشكال العرض ========== */
function Gauge({ value, max, label, color, suffix = '' }) {
  const pct = Math.max(0, Math.min(value / max, 1));
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
      <div style={{ position: 'relative', width: 130, height: 130 }}>
        <svg width="130" height="130" viewBox="0 0 130 130">
          <circle cx="65" cy="65" r={R} fill="none" stroke="rgba(0,229,255,0.1)" strokeWidth="7" />
          <circle cx="65" cy="65" r={R + 8} fill="none" stroke="rgba(0,229,255,0.25)" strokeWidth="1" strokeDasharray="2 6" />
          <circle cx="65" cy="65" r={R} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 65 65)"
            style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(.4,0,.2,1)', filter: `drop-shadow(0 0 8px ${color})` }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 900, color, fontFamily: 'Orbitron, Tajawal', textShadow: `0 0 14px ${color}` }}>{value}{suffix}</div>
        </div>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{label}</div>
    </div>
  );
}

function Donut({ data, hs }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 45;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1.2rem', flexWrap: 'wrap', justifyContent: 'center' }}>
      <svg width="150" height="150" viewBox="0 0 150 150" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="75" cy="75" r={R} fill="none" stroke="rgba(0,229,255,0.08)" strokeWidth="16" />
        {data.filter((d) => d.value > 0).map((d) => {
          const frac = d.value / total;
          const el = (
            <circle key={d.label} cx="75" cy="75" r={R} fill="none" stroke={d.color} strokeWidth="16"
              strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C}
              style={{ filter: `drop-shadow(0 0 6px ${d.color})`, transition: 'all 1s cubic-bezier(.4,0,.2,1)' }} />
          );
          acc += frac;
          return el;
        })}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {data.map((d) => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
            <span style={{ width: 10, height: 10, background: d.color, boxShadow: `0 0 8px ${d.color}`, transform: 'rotate(45deg)' }} />
            <span>{d.label}</span>
            <strong style={{ color: d.color, fontFamily: 'Orbitron', fontSize: '0.8rem' }}>{d.value}{hs}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function Radar({ axes }) {
  const cx = 90, cy = 90, R = 60;
  const n = axes.length;
  const pt = (i, r) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const poly = (r) => axes.map((_, i) => pt(i, r).join(',')).join(' ');
  const dataPoly = axes.map((a, i) => pt(i, R * Math.max(a.value, 0.06)).join(',')).join(' ');
  return (
    <svg width="190" height="180" viewBox="0 0 180 180" style={{ margin: '0 auto', display: 'block' }}>
      {[0.33, 0.66, 1].map((g) => (
        <polygon key={g} points={poly(R * g)} fill="none" stroke="rgba(0,229,255,0.15)" strokeWidth="1" />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(0,229,255,0.12)" strokeWidth="1" />;
      })}
      <polygon points={dataPoly} fill="rgba(0,229,255,0.18)" stroke="#00e5ff" strokeWidth="2"
        style={{ filter: 'drop-shadow(0 0 8px rgba(0,229,255,0.5))', transition: 'all 1s cubic-bezier(.4,0,.2,1)' }} />
      {axes.map((a, i) => {
        const [x, y] = pt(i, R + 15);
        return <text key={i} x={x} y={y} fill="var(--muted)" fontSize="9" textAnchor="middle">{a.label}</text>;
      })}
    </svg>
  );
}

function VBars({ data, hs }) {
  const M = Math.max(...data.map((d) => d.value), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '16px', height: 160, paddingTop: '10px' }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', height: '100%', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: '0.72rem', color: d.color, fontFamily: 'Orbitron' }}>{d.value}{hs}</span>
          <div style={{
            width: 26,
            height: `${Math.max((d.value / M) * 82, 3)}%`,
            background: `linear-gradient(180deg, ${d.color}, transparent)`,
            borderTop: `2px solid ${d.color}`,
            boxShadow: `0 0 14px ${d.color}55`,
            transition: 'height 1.2s cubic-bezier(.4,0,.2,1)',
          }} />
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ========== التوجيه اليومي ========== */
function DirectivePanel() {
  const { lang } = useLang();
  const [directive, setDirective] = useState(null);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/directive`, { method: 'POST', headers, body: JSON.stringify({ lang }) });
      const json = await res.json();
      if (!res.ok) throw new Error(lang === 'ar' ? 'عَقْل مشغول لحظيًا — أعد المحاولة 🙏' : 'AQL is momentarily busy — try again 🙏');
      setDirective(json.directive);
      setApproved(false);
    } catch (e) { /* نتجاهل */ }
    setBusy(false);
  };

  const tagColor = { deep: '#00e5ff', meeting: '#2979ff', rest: '#00e676', warn: '#ff2d78' };

  return (
    <div className="glass-panel hud-panel" style={{ padding: '1.2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, color: 'var(--text)', fontSize: '1rem' }}>⚡ {lang === 'ar' ? 'توجيه اليوم' : 'Daily Directive'}</h3>
        <button onClick={generate} disabled={busy} style={{ padding: '8px 16px', background: 'linear-gradient(90deg,#0077ff,#00e5ff)', color: '#001018', border: 'none', borderRadius: '3px', fontWeight: 800, cursor: 'pointer' }}>
          {busy ? (lang === 'ar' ? '⏳ عَقْل يخطط...' : '⏳ Planning...') : (lang === 'ar' ? '⚡ توليد التوجيه' : '⚡ Generate')}
        </button>
      </div>
      {directive && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          {(directive.slots || []).map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'center', borderRight: `3px solid ${tagColor[s.tag] || '#00e5ff'}`, background: 'rgba(0,229,255,0.05)', padding: '0.7rem 0.9rem', borderRadius: '3px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'Orbitron', color: tagColor[s.tag] || '#00e5ff', fontSize: '0.8rem', minWidth: '90px' }}>{s.time}</span>
              <span style={{ color: 'var(--text)', fontSize: '0.9rem' }}>{s.task}</span>
            </div>
          ))}
          {directive.closing && <p style={{ color: 'var(--muted)', fontStyle: 'italic', margin: '0.3rem 0 0' }}>“{directive.closing}”</p>}
          <button onClick={() => setApproved(true)} disabled={approved} style={{ marginTop: '0.5rem', padding: '10px', background: approved ? 'rgba(0,230,118,0.15)' : 'rgba(0,229,255,0.1)', border: `1px solid ${approved ? 'rgba(0,230,118,0.5)' : 'rgba(0,229,255,0.4)'}`, color: approved ? '#00e676' : 'var(--cyan)', borderRadius: '3px', fontWeight: 800, cursor: 'pointer' }}>
            {approved ? (lang === 'ar' ? '✅ معتمد — عَقْل سيراقب التنفيذ' : '✅ Approved — AQL will monitor') : (lang === 'ar' ? '✅ اعتماد التوجيه' : '✅ Approve')}
          </button>
        </div>
      )}
    </div>
  );
}

/* ========== شريط الوكيل الصوتي ========== */
function VoiceAgentBar({ onRefresh }) {
  const { lang } = useLang();
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [last, setLast] = useState(null);

  const run = async (cmd) => {
    const command = (cmd || '').trim();
    if (!command || busy) return;
    setBusy(true);
    setLast(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/agent`, {
        method: 'POST', headers,
        body: JSON.stringify({ message: command, lang }),
      });
      const json = await res.json();
      if (!res.ok && !json.reply) throw new Error(json.error || 'error');
      setLast(json);
      jarvisSpeak(json.reply, lang, () => onRefresh && onRefresh(), localStorage.getItem('aql-voice') || 'en-GB-RyanNeural');
    } catch (e) {
      setLast({ reply: String(e.message), actions: [] });
      onRefresh && onRefresh();
    }
    setBusy(false);
  };

  const listen = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => { const t = e.results[0][0].transcript; setText(t); run(t); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    try { rec.start(); } catch (err) { setListening(false); }
  };

  return (
    <div className="glass-panel hud-panel" style={{ padding: '1.2rem' }}>
      <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={listen} disabled={busy || listening}
          style={{ padding: '12px 16px', background: listening ? 'rgba(239,68,68,0.2)' : 'rgba(0,229,255,0.1)', border: `1px solid ${listening ? 'rgba(239,68,68,0.5)' : 'rgba(0,229,255,0.4)'}`, color: listening ? '#fca5a5' : 'var(--cyan)', borderRadius: '6px', cursor: 'pointer', fontSize: '1.1rem', boxShadow: listening ? '0 0 18px rgba(239,68,68,0.4)' : 'none' }}>
          {listening ? '🎙️ أسمعك...' : '🎤'}
        </button>
        <input value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(text); }}
          placeholder={lang === 'ar' ? 'قل أو اكتب أمرًا: "وازن أسبوعي"، "أضف دراسة 10 ساعات"...' : 'Say or type: "balance my week", "add study 10h"...'}
          style={{ ...fieldStyle, flex: 1, minWidth: '220px' }} />
        <button onClick={() => run(text)} disabled={busy || !text.trim()}
          style={{ padding: '12px 22px', background: 'linear-gradient(90deg,#0077ff,#00e5ff)', color: '#001018', border: 'none', borderRadius: '6px', fontWeight: 800, cursor: 'pointer' }}>
          {busy ? '⚙️ ينفّذ...' : '⚡ نفّذ'}
        </button>
      </div>
      {last && (
        <div style={{ marginTop: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {(last.actions || []).map((a, i) => (
            <div key={i} style={{ fontSize: '0.8rem', color: '#00e676', background: 'rgba(0,230,118,0.08)', border: '1px solid rgba(0,230,118,0.3)', borderRadius: '4px', padding: '0.4rem 0.7rem' }}>
              ⚙️ {prettyAction(a.result)}
            </div>
          ))}
          <p style={{ margin: 0, color: 'var(--text)', fontStyle: 'italic' }}>🎩 {last.reply}</p>
        </div>
      )}
    </div>
  );
}

/* ========== الرادار الدوّار ========== */
function RadarPanel({ risk }) {
  return (
    <div>
      <div className="radar-wrap">
        <div className="radar-sweep" />
        <svg viewBox="0 0 200 200" className="radar-svg">
          <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(0,229,255,.25)" strokeWidth="1" />
          <circle cx="100" cy="100" r="62" fill="none" stroke="rgba(0,229,255,.18)" strokeWidth="1" strokeDasharray="3 6" />
          <circle cx="100" cy="100" r="36" fill="none" stroke="rgba(0,229,255,.15)" strokeWidth="1" strokeDasharray="2 5" />
          <line x1="100" y1="8" x2="100" y2="192" stroke="rgba(0,229,255,.1)" />
          <line x1="8" y1="100" x2="192" y2="100" stroke="rgba(0,229,255,.1)" />
          <circle cx="132" cy="70" r="3" fill="var(--cyan)" className="blip" />
          <circle cx="70" cy="126" r="2.5" fill="var(--cyan)" className="blip b2" />
          <circle cx="118" cy="138" r="2" fill={risk.color} className="blip b3" />
        </svg>
      </div>
      <div className="searching mono">SEARCHING<span className="dots">...</span></div>
      <div className="radar-read mono"><span>AZ 217.4°</span><span>RNG 0.42</span><span style={{ color: risk.color }}>SIG {risk.label.toUpperCase()}</span></div>
    </div>
  );
}

/* ========== الكرة الهولوغرامية ========== */
function GlobePanel() {
  const dots = Array.from({ length: 42 }, (_, i) => {
    const a = (i / 42) * Math.PI * 2;
    const r = 70 + Math.sin(i * 7.3) * 10;
    return { x: 100 + Math.cos(a) * r, y: 100 + Math.sin(a) * r * 0.9, o: 0.3 + Math.abs(Math.sin(i * 3.1)) * 0.7 };
  });
  return (
    <svg viewBox="0 0 200 200" className="globe-svg">
      <circle cx="100" cy="100" r="78" fill="none" stroke="rgba(0,229,255,.3)" />
      <ellipse cx="100" cy="100" rx="78" ry="26" fill="none" stroke="rgba(0,229,255,.18)" />
      <ellipse cx="100" cy="100" rx="78" ry="52" fill="none" stroke="rgba(0,229,255,.12)" />
      <ellipse cx="100" cy="100" rx="30" ry="78" fill="none" stroke="rgba(0,229,255,.15)" />
      <ellipse cx="100" cy="100" rx="58" ry="78" fill="none" stroke="rgba(0,229,255,.1)" />
      <g className="globe-dots">{dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r="1.6" fill="var(--cyan)" opacity={d.o} />)}</g>
      <line x1={dots[3].x} y1={dots[3].y} x2={dots[18].x} y2={dots[18].y} stroke="rgba(0,229,255,.35)" strokeWidth="0.6" />
      <line x1={dots[10].x} y1={dots[10].y} x2={dots[30].x} y2={dots[30].y} stroke="rgba(0,229,255,.3)" strokeWidth="0.6" />
      <line x1={dots[22].x} y1={dots[22].y} x2={dots[38].x} y2={dots[38].y} stroke="rgba(0,229,255,.3)" strokeWidth="0.6" />
    </svg>
  );
}

/* ========== أعمدة الطاقة ========== */
function BatteryPanel({ commitments, life }) {
  const total = commitments.reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
  const cols = [
    { label: 'TIME', pct: total / 168 },
    { label: 'FIN', pct: life?.finance ? Math.max(0, Math.min(1, (life.finance.balance + 2000) / 4000)) : 0.4 },
    { label: 'REST', pct: Math.max(0, Math.min(1, (168 - total) / 80)) },
    { label: 'MOOD', pct: (life?.wellness?.mood || 5) / 10 },
  ];
  return (
    <div className="battery-row">
      {cols.map((c) => (
        <div key={c.label} className="battery-col">
          <div className="battery-segs">{Array.from({ length: 12 }, (_, i) => <span key={i} className={(11 - i) / 12 <= c.pct ? 'seg lit' : 'seg'} />)}</div>
          <span className="mono battery-lbl">{c.label}</span>
          <span className="mono battery-pct">{Math.round(c.pct * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

/* ========== كرة الحياة المتحركة (3D) ========== */
function AnimatedGlobe() {
  useEffect(() => {
    const canvas = document.getElementById('life-globe');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = (canvas.width = 260), H = (canvas.height = 260);
    const cx = W / 2, cy = H / 2, R = 110;
    const N = 70;
    const dots = Array.from({ length: N }, (_, i) => ({
      phi: Math.acos(1 - (2 * (i + 0.5)) / N),
      theta: Math.PI * (1 + Math.sqrt(5)) * i,
    }));
    let rot = 0, raf;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      rot += 0.004;
      ctx.strokeStyle = 'rgba(0,229,255,0.22)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      for (let m = 0; m < 3; m++) {
        const w = Math.abs(Math.cos(rot * 0.7 + (m * Math.PI) / 3));
        ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(w * R, 6), R, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
      const pts = dots.map((d) => {
        const x3 = Math.sin(d.phi) * Math.cos(d.theta + rot);
        const y3 = Math.sin(d.phi) * Math.sin(d.theta + rot);
        const z3 = Math.cos(d.phi);
        return { x: cx + x3 * R, y: cy + y3 * R * 0.92, z: (z3 + 1) / 2 };
      });
      ctx.strokeStyle = 'rgba(0,229,255,0.18)';
      for (let i = 0; i < pts.length; i += 6) {
        const a = pts[i], b = pts[(i + 9) % pts.length];
        if (a.z > 0.45 && b.z > 0.45) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      for (const p of pts) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.2 + p.z * 1.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,229,255,${0.2 + p.z * 0.7})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas id="life-globe" className="globe-canvas" />;
}

/* ========== الرادار الحيوي المتحرك ========== */
function AnimatedRadar({ risk }) {
  return (
    <div>
      <div className="radar-box">
        <div className="radar-sweep" />
        <svg viewBox="0 0 200 200" className="radar-svg">
          <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(0,229,255,0.3)" strokeWidth="1" />
          <circle cx="100" cy="100" r="60" fill="none" stroke="rgba(0,229,255,0.2)" strokeWidth="1" strokeDasharray="3 6" />
          <circle cx="100" cy="100" r="32" fill="none" stroke="rgba(0,229,255,0.15)" strokeWidth="1" strokeDasharray="2 5" />
          <line x1="100" y1="12" x2="100" y2="188" stroke="rgba(0,229,255,0.12)" strokeWidth="1" />
          <line x1="12" y1="100" x2="188" y2="100" stroke="rgba(0,229,255,0.12)" strokeWidth="1" />
          <circle className="blip b1" cx="132" cy="68" r="3" fill="#00e5ff" />
          <circle className="blip b2" cx="68" cy="122" r="2.5" fill="#00e5ff" />
          <circle className="blip b3" cx="122" cy="132" r="2.5" fill={risk.color} />
        </svg>
      </div>
      <div className="searching mono">SEARCHING<span className="dots">...</span></div>
      <div className="radar-read mono">
        <span>AZ 217.4°</span><span>RNG 0.42</span><span style={{ color: risk.color }}>SIG {risk.label.toUpperCase()}</span>
      </div>
    </div>
  );
}

/* ========== كرة الحياة + الرادار الحي ========== */
function GlobeSVG() {
  const dots = Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    const r = 34 + ((i * 37) % 12);
    return { x: 50 + Math.cos(a) * r, y: 50 + Math.sin(a) * r * 0.9 };
  });
  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
      <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(0,229,255,0.3)" />
      <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="rgba(0,229,255,0.18)" />
      <ellipse cx="50" cy="50" rx="46" ry="30" fill="none" stroke="rgba(0,229,255,0.12)" />
      <ellipse cx="50" cy="50" rx="18" ry="46" fill="none" stroke="rgba(0,229,255,0.15)" />
      <ellipse cx="50" cy="50" rx="32" ry="46" fill="none" stroke="rgba(0,229,255,0.1)" />
      {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r="1.2" fill="var(--cyan)" opacity={0.4 + ((i * 29) % 50) / 100} />)}
    </svg>
  );
}
function VitalRadar({ riskPct, riskColor, loads }) {
  const rMain = 14 + (riskPct / 100) * 62;
  const aMain = -Math.PI / 4;
  const mx = 90 + Math.cos(aMain) * rMain;
  const my = 90 + Math.sin(aMain) * rMain;
  return (
    <div style={{ position: 'relative', width: 210, height: 210, margin: '0 auto' }}>
      <div className="radar-sweep" />
      <svg viewBox="0 0 180 180" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <circle cx="90" cy="90" r="78" fill="none" stroke="rgba(0,229,255,0.25)" strokeWidth="1" />
        <circle cx="90" cy="90" r="52" fill="none" stroke="rgba(0,229,255,0.15)" strokeWidth="1" strokeDasharray="3 6" />
        <circle cx="90" cy="90" r="26" fill="none" stroke="rgba(0,229,255,0.12)" strokeWidth="1" strokeDasharray="2 5" />
        <line x1="90" y1="12" x2="90" y2="168" stroke="rgba(0,229,255,0.1)" />
        <line x1="12" y1="90" x2="168" y2="90" stroke="rgba(0,229,255,0.1)" />
        <line x1="90" y1="90" x2={mx} y2={my} stroke={riskColor} strokeWidth="1" opacity="0.6" />
        <circle cx={mx} cy={my} r="4" fill={riskColor} className="blip" />
        {loads.map((d, i) => {
          const a = (i / Math.max(loads.length, 1)) * Math.PI * 2 - Math.PI / 2;
          const r = 14 + d.value * 60;
          return <circle key={i} cx={90 + Math.cos(a) * r} cy={90 + Math.sin(a) * r} r="2.5" fill={d.color} className="blip" style={{ animationDelay: `${i * 0.3}s` }} />;
        })}
      </svg>
    </div>
  );
}

function MemoryTimeline() {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/api/analysis-logs`, { headers });
        const json = await res.json();
        if (res.ok) setLogs((json.logs || []).slice(0, 6));
      } catch (e) { /* نتجاهل */ }
    })();
  }, []);
  const rank = (r) => (r === 'Critical' ? 3 : r === 'High' ? 2 : r === 'Medium' ? 1 : 0);
  const color = (r) => (r === 'Critical' ? '#ff4d4d' : r === 'High' ? '#ff9100' : r === 'Medium' ? '#ffb020' : '#00e676');
  if (!logs.length) return null;
  const ordered = [...logs].reverse();
  return (
    <div className="memory-timeline">
      <div className="memory-title mono">AQL MEMORY</div>
      <div className="memory-track">
        {ordered.map((log, i) => {
          const prev = ordered[i - 1];
          const delta = prev ? rank(log.burnout_risk) - rank(prev.burnout_risk) : 0;
          const arrow = delta > 0 ? '↓' : delta < 0 ? '↑' : '•';
          const aCol = delta > 0 ? '#ff4d4d' : delta < 0 ? '#00e676' : 'var(--muted)';
          return (
            <div key={log.id} className="memory-node">
              <span className="memory-arrow" style={{ color: aCol }}>{arrow}</span>
              <span className="memory-dot" style={{ borderColor: color(log.burnout_risk), boxShadow: `0 0 10px ${color(log.burnout_risk)}66` }} />
              <span className="memory-date">{new Date(log.created_at).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ========== غرفة الوعي — العقل الحي ========== */
function MindChamber({ commitments }) {
  const { lang, hs } = useLang();
  const [life, setLife] = useState(null);
  const [logs, setLogs] = useState([]);
  const [fullThought, setFullThought] = useState(lang === 'ar' ? 'أُوقظ وعيي... أقرأ ملفاتك يا سيدي.' : 'Waking my consciousness... reading your files, sir.');
  const [typed, setTyped] = useState('');
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [actions, setActions] = useState([]);
  const [activeDomain, setActiveDomain] = useState(null);
  const [memory, setMemory] = useState([]);
  const [lastEngine, setLastEngine] = useState(null);
  const [thinking, setThinking] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const [f, w, r, h, s, lg] = await Promise.all([
          fetch(`${API_URL}/api/finance`, { headers }), fetch(`${API_URL}/api/wellness`, { headers }),
          fetch(`${API_URL}/api/relationships`, { headers }), fetch(`${API_URL}/api/home`, { headers }),
          fetch(`${API_URL}/api/study`, { headers }), fetch(`${API_URL}/api/analysis-logs`, { headers }),
        ]);
        const fj = f.ok ? await f.json() : null; const wj = w.ok ? await w.json() : null;
        const rj = r.ok ? await r.json() : null; const hj = h.ok ? await h.json() : null;
        const sj = s.ok ? await s.json() : null; const lgj = lg.ok ? await lg.json() : null;
        setLife({ finance: fj || null, wellness: wj?.logs?.[0] || null, relationships: rj?.people || [], home: hj?.tasks || [], studyMinutes: sj?.total_minutes || 0 });
        setLogs(lgj?.logs || []);
      } catch (e) { /* نتجاهل */ }
    })();
  }, [commitments]);
  useEffect(() => {
  (async () => {
    try {
      const headers = await getAuthHeaders();
      const r = await fetch(`${API_URL}/api/analysis-logs`, { headers });
      const j = await r.json();
      if (r.ok) setMemory((j.logs || []).slice(0, 3));
    } catch (e) { /* نتجاهل */ }
  })();
}, [commitments]);

  const totalHours = Math.round(commitments.reduce((s, c) => s + Number(c.hours_per_week || 0), 0) * 10) / 10;
  const remaining = Math.max(168 - totalHours, 0);
  const risk = riskOf(totalHours);
  const riskPct = risk.label === 'Critical' ? 95 : risk.label === 'High' ? 70 : risk.label === 'Medium' ? 45 : 15;
  const highHours = commitments.filter((c) => c.intensity === 'high').reduce((s, c) => s + Number(c.hours_per_week), 0);
  const neglectedCount = (people) => (people || []).filter((p) => !p.last_contact || (Date.now() - new Date(p.last_contact).getTime()) / 86400000 > (p.contact_frequency_days || 7)).length;
  const RISK_ORDER = ['Low', 'Medium', 'High', 'Critical'];

  /* اتجاهات عبر الزمن (بادرة + ذاكرة) */
  const spendTrend = (() => {
    const entries = life?.finance?.entries || [];
    const now = Date.now();
    const last7 = entries.filter((e) => e.type === 'expense' && now - new Date(e.entry_date).getTime() < 7 * 86400000).reduce((s, e) => s + Number(e.amount), 0);
    const prev7 = entries.filter((e) => e.type === 'expense' && now - new Date(e.entry_date).getTime() >= 7 * 86400000 && now - new Date(e.entry_date).getTime() < 14 * 86400000).reduce((s, e) => s + Number(e.amount), 0);
    if (prev7 <= 0) return null;
    return Math.round(((last7 - prev7) / prev7) * 100);
  })();
  const riskTrend = logs.length >= 2 ? RISK_ORDER.indexOf(logs[0].burnout_risk) - RISK_ORDER.indexOf(logs[1].burnout_risk) : 0;

  /* البادرة: تيار الوعي يفتح بملاحظات استباقية */
  useEffect(() => {
    if (!life) return;
    const bal = Math.round(life.finance?.summary?.balance || 0);
    const negl = neglectedCount(life.relationships);
    const pending = (life.home || []).filter((x) => x.status !== 'done').length;
    const notes = [lang === 'ar'
      ? `سيدي، وعيي مكتمل. أسبوعك يحمل ${totalHours} ساعة (خطر: ${risk.label})، رصيدك ${bal}.`
      : `Sir, consciousness complete. Week carries ${totalHours}h (risk: ${risk.label}), balance ${bal}.`];
    if (spendTrend !== null && spendTrend >= 20) notes.push(lang === 'ar' ? `لاحظت أن مصروفك زاد ${spendTrend}% مقارنة بالأسبوع الماضي.` : `I noticed your spending rose ${spendTrend}% versus last week.`);
    if (riskTrend > 0) notes.push(lang === 'ar' ? 'مستوى خطرك ارتفع منذ آخر تحليل — أوصي بالمراجعة.' : 'Your risk climbed since the last analysis — a review is advisable.');
    else if (riskTrend < 0) notes.push(lang === 'ar' ? 'تحسّن ملحوظ منذ آخر تحليل — أحسنت يا سيدي.' : 'Marked improvement since the last analysis — well done, sir.');
    if (negl) notes.push(lang === 'ar' ? `${negl} من علاقاتك تنتظر اتصالك.` : `${negl} relationships await your call.`);
    if (pending) notes.push(lang === 'ar' ? `${pending} مهام منزلية معلّقة.` : `${pending} home tasks pending.`);
    setFullThought(notes.join(' '));
  }, [life, lang]);

  useEffect(() => {
    setTyped(''); let i = 0;
    const iv = setInterval(() => { i += 2; setTyped(fullThought.slice(0, i)); if (i >= fullThought.length) clearInterval(iv); }, 28);
    return () => clearInterval(iv);
  }, [fullThought]);

  const GOOD = 'rgba(0,230,118,0.55)'; const WARN = '#ffb020'; const DANGER = '#ff4d4d';
  const domainStatus = (id) => {
  if (!life) return { color: GOOD, w: 1.5, hot: false };
  if (id === 'time') { if (risk.label === 'Critical' || risk.label === 'High') return { color: DANGER, w: 2, hot: true }; if (risk.label === 'Medium') return { color: WARN, w: 2, hot: true }; return { color: GOOD, w: 1.5, hot: false }; }
  if (id === 'finance') return (life.finance?.balance || 0) < 0 ? { color: DANGER, w: 2, hot: true } : { color: GOOD, w: 1.5, hot: false };
  if (id === 'study') return (life.studyMinutes || 0) > 0 ? { color: GOOD, w: 1.5, hot: false } : { color: WARN, w: 2, hot: true };
  if (id === 'home') return (life.home || []).filter((x) => x.status !== 'done').length > 5 ? { color: WARN, w: 2, hot: true } : { color: GOOD, w: 1.5, hot: false };
  if (id === 'relations') return neglectedCount(life.relationships) > 0 ? { color: WARN, w: 2, hot: true } : { color: GOOD, w: 1.5, hot: false };
  if (id === 'health') { const w = life.wellness; return w && ((w.sleep_hours || 0) < 7 || (w.mood || 10) < 5) ? { color: WARN, w: 2, hot: true } : { color: GOOD, w: 1.5, hot: false }; }
  return { color: GOOD, w: 1.5, hot: false };
};
  const domains = [
    { id: 'time', icon: '⏳', label: lang === 'ar' ? 'الوقت' : 'Time', angle: -90 },
    { id: 'finance', icon: '💰', label: lang === 'ar' ? 'المال' : 'Finance', angle: -30 },
    { id: 'study', icon: '📚', label: lang === 'ar' ? 'الدراسة' : 'Study', angle: 30 },
    { id: 'home', icon: '🏠', label: lang === 'ar' ? 'البيت' : 'Home', angle: 90 },
    { id: 'relations', icon: '🤝', label: lang === 'ar' ? 'العلاقات' : 'Relations', angle: 150 },
    { id: 'health', icon: '🧘', label: lang === 'ar' ? 'الصحة' : 'Health', angle: 210 },
  ];
  const domainLoads = life ? domains.map((d) => {
    const st = domainStatus(d.id);
    let v = 0.2;
    if (d.id === 'time') v = Math.min(totalHours / 168, 1);
    if (d.id === 'finance') { const s = life.finance?.summary; v = s ? (s.balance < 0 ? 0.9 : s.income > 0 ? Math.min(s.expense / s.income, 1) : 0.5) : 0.3; }
    if (d.id === 'home') v = Math.min((life.home || []).filter((x) => x.status !== 'done').length / 10, 1);
    if (d.id === 'relations') { const c = (life.relationships || []).length || 1; v = Math.min(neglectedCount(life.relationships) / c, 1); }
    if (d.id === 'health') v = life.wellness ? Math.min(1 - (life.wellness.mood || 5) / 10, 1) : 0.3;
    if (d.id === 'study') v = Math.min((life.studyMinutes || 0) / 600, 1);
    return { value: v, color: st.color };
  }) : [];

  const domainThought = (id) => {
    if (!life) return '';
    const bal = Math.round(life.finance?.summary?.balance || 0);
    const negl = neglectedCount(life.relationships);
    const pending = (life.home || []).filter((x) => x.status !== 'done').length;
    const w = life.wellness;
    if (lang === 'ar') {
      switch (id) {
        case 'time': return `أفكّر في وقتك يا سيدي: ${totalHours} ساعة ملتزم بها، و${remaining} ساعة حرة. ${risk.label === 'Low' ? 'توازن جميل.' : 'أرصد ضغطًا — دعني أخفّف عنك.'}`;
        case 'finance': return bal < 0 ? `رصيدك سالب (${bal}) يا سيدي. أوصي بفرملة فورية.` : `رصيدك ${bal} يا سيدي. انضباطك المالي ${bal > 0 ? 'مقبول' : 'على الحافة'}.`;
        case 'study': return `سجلت ${Math.round((life.studyMinutes || 0) / 60)} ساعة دراسة يا سيدي. ${(life.studyMinutes || 0) > 600 ? 'وتيرة ممتازة.' : 'يمكنني رفع استثمارك المعرفي إن أمرت.'}`;
        case 'home': return pending > 0 ? `لديك ${pending} مهام منزلية معلّقة يا سيدي. الفوضى تتراكم بصمت.` : 'المنزل تحت السيطرة يا سيدي.';
        case 'relations': return negl > 0 ? `${negl} من علاقاتك تنتظر اتصالك يا سيدي. العلاقات رأس مال صامت.` : 'جميع علاقاتك نشطة يا سيدي. أحسنت.';
        default: return w ? `مزاجك ${w.mood}/10 وطاقتك ${w.energy}/10 ونومك ${w.sleep_hours} ساعة يا سيدي. ${(w.sleep_hours || 0) < 7 ? 'أوصي ببروتوكول نوم صارم الليلة.' : 'الجسد متماسك.'}` : 'لا بيانات صحية بعد يا سيدي.';
      }
    }
    switch (id) {
      case 'time': return `Reflecting on your time, sir: ${totalHours}h committed, ${remaining}h free. ${risk.label === 'Low' ? 'A fine balance.' : 'I sense strain — allow me to lighten it.'}`;
      case 'finance': return bal < 0 ? `Your balance is negative (${bal}), sir. I advise an immediate brake.` : `Balance ${bal}, sir. ${bal > 0 ? 'Acceptable discipline.' : 'On the edge.'}`;
      case 'study': return `You logged ${Math.round((life.studyMinutes || 0) / 60)}h of study, sir. ${(life.studyMinutes || 0) > 600 ? 'Excellent pace.' : 'I can raise your cognitive investment, if you command.'}`;
      case 'home': return pending > 0 ? `${pending} home tasks pending, sir. Chaos accumulates silently.` : 'The household is under control, sir.';
      case 'relations': return negl > 0 ? `${negl} relationships await your call, sir. Bonds are silent capital.` : 'All relationships active, sir. Well done.';
      default: return w ? `Mood ${w.mood}/10, energy ${w.energy}/10, sleep ${w.sleep_hours}h, sir. ${(w.sleep_hours || 0) < 7 ? 'I recommend a strict sleep protocol tonight.' : 'The body holds firm.'}` : 'No wellness data yet, sir.';
    }
  };
  
  const focusDomain = (d) => { setActiveDomain(d.id); const line = domainThought(d.id); setFullThought(line); jarvisSpeak(line, lang); };
  const sendCommand = async (text) => {
    const cmd = (text || '').trim();
    if (!cmd || busy) return;
    setBusy(true); setActions([]);
    setFullThought(lang === 'ar' ? 'أعالج أمرك يا سيدي...' : 'Processing your command, sir...');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/agent`, { method: 'POST', headers, body: JSON.stringify({ message: cmd, lang }) });
      const json = await res.json();
      const reply = json.reply || (lang === 'ar' ? 'تعذّر الوصول لمحركاتي يا سيدي.' : 'My engines are unreachable, sir.');
      setActions(json.actions || []);
      setLastEngine(json.engine || 'rules');
      setFullThought(reply);
      jarvisSpeak(reply, lang);
    } catch (e) { setFullThought(lang === 'ar' ? 'حدث خلل لحظي يا سيدي.' : 'A momentary glitch, sir.'); }
    setBusy(false);
  };
  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    jarvisStop();
    const rec = new SR();
    rec.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
    rec.interimResults = false;
    rec.onresult = (e) => { const t2 = e.results[0][0].transcript; setCommand(t2); sendCommand(t2); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    try { rec.start(); } catch (e) { setListening(false); }
  };
  const engineMeta = lastEngine === 'gemini' || lastEngine === 'cerebras'
    ? { color: '#c4b5fd', label: lang === 'ar' ? 'تفكير عميق' : 'DEEP THINK' }
    : lastEngine === 'groq'
      ? { color: '#4dd8ff', label: lang === 'ar' ? 'تحليل سريع' : 'FAST ANALYSIS' }
      : { color: '#7d9bb8', label: lang === 'ar' ? 'استجابة فورية' : 'INSTANT' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      <div className="hud-grid4">
        {/* LIFE SCAN: كرة + أعصاب متصلة */}
        <div className="glass-panel hud-panel hud-box">
          <div className="holo-label">◈ {lang === 'ar' ? 'مسح الحياة' : 'LIFE SCAN'}</div>
          <div className={busy ? 'core-thinking' : ''} style={{ position: 'relative', width: '100%', maxWidth: 320, aspectRatio: '1 / 1', margin: '0 auto' }}>
            <svg className="neural-links" viewBox="0 0 100 100" preserveAspectRatio="none">
              {domains.map((d) => {
                const rad = (d.angle * Math.PI) / 180;
                const x = 50 + 46 * Math.cos(rad); const y = 50 + 46 * Math.sin(rad);
                const st = domainStatus(d.id);
                return <line key={d.id} x1="50" y1="50" x2={x} y2={y} stroke={st.color} strokeWidth={st.w} vectorEffect="non-scaling-stroke" className={st.hot ? 'nl-hot' : 'nl-calm'} style={{ color: st.color }} />;
              })}
            </svg>
            <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '60%', height: '60%' }}>
              <GlobeSVG />
            </div>
            {domains.map((d) => {
              const rad = (d.angle * Math.PI) / 180;
              const x = 50 + 46 * Math.cos(rad); const y = 50 + 46 * Math.sin(rad);
              const st = domainStatus(d.id);
              return (
                <button key={d.id} className="mind-node" onClick={() => focusDomain(d)}
                  style={{ left: `${x}%`, top: `${y}%`, borderColor: st.hot ? st.color : undefined, color: st.hot ? st.color : undefined, boxShadow: activeDomain === d.id ? `0 0 22px ${st.color}` : undefined, padding: '6px 10px', fontSize: '0.68rem' }}>
                  <span>{d.icon}</span>
                  <span>{d.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        {/* VITAL RADAR: بيانات حقيقية */}
        <div className="glass-panel hud-panel hud-box">
          <div className="holo-label">◈ {lang === 'ar' ? 'الرادار الحيوي' : 'VITAL RADAR'}</div>
          <VitalRadar riskPct={riskPct} riskColor={risk.color} loads={domainLoads} />
          <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--muted)' }}>
            <span>AZ 217.4°</span>
            <span>RNG {totalHours}{hs}</span>
            <span style={{ color: risk.color }}>SIG {risk.label.toUpperCase()}</span>
          </div>
        </div>
        {/* ENERGY */}
        <div className="glass-panel hud-panel hud-box">
          <div className="holo-label">◈ {lang === 'ar' ? 'الطاقة' : 'ENERGY'}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1.4rem', paddingTop: '0.6rem' }}>
            {[
              { l: 'TIME', v: Math.min(totalHours / 168, 1) },
              { l: 'FIN', v: life?.finance?.summary ? Math.max(0, Math.min(1, (life.finance.summary.balance + 2000) / 4000)) : 0 },
              { l: 'REST', v: Math.max(0, Math.min(1, remaining / 80)) },
              { l: 'MOOD', v: (life?.wellness?.mood || 5) / 10 },
            ].map((b) => (
              <div key={b.l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 3, height: 110 }}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <span key={i} style={{ width: 12, height: 6, background: (i / 12) <= b.v ? 'linear-gradient(90deg,#2979ff,#00e5ff)' : 'rgba(0,229,255,0.08)', boxShadow: (i / 12) <= b.v ? '0 0 8px rgba(0,229,255,0.5)' : 'none' }} />
                  ))}
                </div>
                <span className="mono" style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>{b.l}</span>
                <span className="mono" style={{ fontSize: '0.62rem', color: 'var(--cyan)' }}>{Math.round(b.v * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
        {/* CORE */}
        <div className="glass-panel hud-panel hud-box">
          <div className="holo-label">◈ {lang === 'ar' ? 'النواة' : 'CORE'}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1.2rem', flexWrap: 'wrap' }}>
            <Gauge value={Math.round(totalHours)} max={168} label={lang === 'ar' ? 'ساعات' : 'Hours'} color="#00e5ff" suffix={hs} />
            <Gauge value={riskPct} max={100} label={lang === 'ar' ? 'الخطر' : 'Risk'} color={risk.color} suffix="%" />
          </div>
          <div className="sys-line" style={{ color: risk.color }}>
            {lang === 'ar' ? `حالة النظام: ${risk.label === 'Low' ? 'مستقر' : risk.label === 'Medium' ? 'متوتر' : 'حرج'}` : `SYSTEM: ${risk.label === 'Low' ? 'STABLE' : risk.label === 'Medium' ? 'STRAINED' : 'CRITICAL'}`}
            <span className="mono"> // {totalHours}{hs} / 168{hs}</span>
          </div>
        </div>
      </div>
      {/* ذاكرة عَقْل المرئية */}
      {logs.length > 0 && (
        <div className="hud-corners" style={{ padding: '0.8rem 1.1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span className="stream-head mono">{lang === 'ar' ? 'ذاكرة عَقْل' : 'AQL MEMORY'}</span>
          {logs.slice(0, 3).map((log, i) => {
            const prev = logs[i + 1];
            const li = RISK_ORDER.indexOf(log.burnout_risk);
            const pi = prev ? RISK_ORDER.indexOf(prev.burnout_risk) : li;
            const arrow = li > pi ? '▲' : li < pi ? '▼' : '•';
            const col = log.burnout_risk === 'Critical' || log.burnout_risk === 'High' ? '#ff4d4d' : log.burnout_risk === 'Medium' ? '#ffb020' : '#00e676';
            return (
              <span key={log.id} className="mono" style={{ fontSize: '0.62rem', padding: '4px 10px', border: `1px solid ${col}55`, color: col, borderRadius: 999 }}>
                {new Date(log.created_at).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en')} · {log.burnout_risk} {arrow}
              </span>
            );
          })}
        </div>
      )}
      {/* تيار الوعي + مؤشر مستوى الوعي */}
      <div className="hud-corners" style={{ padding: '1.1rem 1.3rem', minHeight: 96 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="stream-head mono">{lang === 'ar' ? 'تيار الوعي' : 'CONSCIOUSNESS STREAM'}</div>
          {lastEngine && <span className="mono" style={{ fontSize: '0.6rem', color: engineMeta.color }}>◉ {engineMeta.label}</span>}
        </div>
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text)', lineHeight: 1.9, fontSize: '1.02rem' }}>{typed}<span className="caret">▌</span></p>
        {busy && <div className="think-wave">{Array.from({ length: 24 }).map((_, i) => <span key={i} style={{ animationDelay: `${i * 0.05}s` }} />)}</div>}
        {actions.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {actions.map((a, i) => (
              <span key={i} className="mono" style={{ fontSize: '0.72rem', padding: '4px 10px', borderRadius: 999, border: '1px solid rgba(0,229,255,0.35)', background: 'rgba(0,229,255,0.07)', color: '#9fe8ff' }}>⚙️ {a.result}</span>
            ))}
          </div>
        )}
      </div>
      {memory.length > 0 && (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
    <span className="mono" style={{ fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.2em' }}>{lang === 'ar' ? 'الذاكرة:' : 'MEMORY:'}</span>
    {memory.map((log) => (
      <span key={log.id} className="mono" style={{ fontSize: '0.62rem', padding: '3px 10px', borderRadius: 999, border: `1px solid ${log.burnout_risk === 'Critical' || log.burnout_risk === 'High' ? 'rgba(255,77,77,0.4)' : 'rgba(0,229,255,0.25)'}`, color: log.burnout_risk === 'Critical' || log.burnout_risk === 'High' ? '#ff8f8f' : 'var(--muted)' }}>
        {new Date(log.created_at).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en')} · {log.burnout_risk}
      </span>
    ))}
  </div>
)}
      <form onSubmit={(e) => { e.preventDefault(); sendCommand(command); setCommand(''); }} style={{ display: 'flex', gap: 8 }}>
        <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder={lang === 'ar' ? 'خاطب عقلك... «وازن أسبوعي»، «سجل مصروف 50»' : 'Address your mind... "balance my week"'} style={{ ...fieldStyle, flex: 1, fontSize: '1.05rem' }} />
        <button type="button" onClick={startListening} disabled={busy || listening} style={{ padding: '12px 16px', background: listening ? 'rgba(255,77,77,0.15)' : 'rgba(0,229,255,0.08)', border: `1px solid ${listening ? 'rgba(255,77,77,0.5)' : 'rgba(0,229,255,0.35)'}`, color: listening ? '#ff8f8f' : '#7dd3fc', borderRadius: 10, cursor: 'pointer', fontSize: '1.1rem' }}>
          {listening ? '🎙️' : '🎤'}
        </button>
        <button type="submit" disabled={busy || !command.trim()} style={{ padding: '12px 26px', background: 'linear-gradient(90deg,#0077ff,#00e5ff)', color: '#001018', border: 'none', borderRadius: 10, fontWeight: 800, cursor: 'pointer' }}>⚡</button>
      </form>
    </div>
  );
}

/* ========== شريط هولوغرامي زخرفي ========== */
function HoloDecor() {
  const bars = [35, 60, 45, 80, 55, 70, 40, 90, 65, 50, 75, 60, 85, 45];
  return (
    <div className="holo-strip" aria-hidden="true">
      <div className="holo-cell">
        <div className="holo-label">POWER</div>
        <div className="holo-bars">{bars.map((h, i) => <span key={i} style={{ height: `${h}%`, animationDelay: `${i * 0.12}s` }} />)}</div>
      </div>
      <div className="holo-cell">
        <div className="holo-label">SIGNAL</div>
        <div className="holo-dots">{Array.from({ length: 40 }).map((_, i) => <span key={i} className={[7, 12, 21, 28, 33].includes(i) ? 'on' : ''} />)}</div>
      </div>
      <div className="holo-cell">
        <div className="holo-label">UPLINK</div>
        <div className="holo-code">01.1.25.9.55.88.144<br />AQL.220.14.07.118<br />NODE.01R.ACTIVE</div>
      </div>
    </div>
  );
}

/* ========== مركز القيادة ========== */
function DashboardPage({ commitments, goInvestigate, onRefresh }) {
  useEffect(() => { fetch(`${API_URL}/api/health`).catch(() => {}); }, []);
  const { lang, t, hs } = useLang();
  const totalHours = commitments.reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
  const remaining = Math.max(168 - totalHours, 0);
  const risk = riskOf(totalHours);
  const highHours = commitments.filter((c) => c.intensity === 'high').reduce((s, c) => s + Number(c.hours_per_week), 0);
  const rigidHours = commitments.filter((c) => !c.flexible).reduce((s, c) => s + Number(c.hours_per_week), 0);
  const flexibleHours = totalHours - rigidHours;
  const morningHours = commitments.filter((c) => c.timeSlot === 'morning').reduce((s, c) => s + Number(c.hours_per_week), 0);

  const riskPct = risk.label === 'Critical' ? 95 : risk.label === 'High' ? 70 : risk.label === 'Medium' ? 45 : 15;

  const typeData = Object.keys(typeLabels).map((k) => ({
    label: t(typeLabels[k]),
    value: commitments.filter((c) => c.type === k).reduce((s, c) => s + Number(c.hours_per_week), 0),
    color: typeColors[k],
  }));

  const slotColors = { morning: '#00e5ff', afternoon: '#2979ff', evening: '#4dd8ff', late_night: '#ff4d4d', mixed: '#7d9bb8' };
  const slotData = Object.keys(slotLabels).map((k) => ({
    label: t(slotLabels[k]),
    value: commitments.filter((c) => c.timeSlot === k).reduce((s, c) => s + Number(c.hours_per_week), 0),
    color: slotColors[k],
  }));

  const radarAxes = [
    { label: t('راحة'), value: remaining / 168 },
    { label: t('هدوء'), value: totalHours ? 1 - Math.min(highHours / totalHours, 1) : 1 },
    { label: t('مرونة'), value: totalHours ? flexibleHours / totalHours : 1 },
    { label: t('صباح'), value: totalHours ? morningHours / totalHours : 0 },
    { label: t('انضباط'), value: totalHours ? 1 - Math.min(rigidHours / totalHours, 1) : 1 },
  ];

  useEffect(() => {
    const h = new Date().getHours();
    const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';

    const pools = {
      Low: [
        `Good ${part}, sir. All systems stable; your schedule is under complete control.`,
        `Good ${part}, sir. A beautifully balanced week. Do carry on.`,
        `Good ${part}, sir. Everything within safe parameters. Shall we push a little further?`,
      ],
      Medium: [
        `Good ${part}, sir. A slight strain on the horizon. I advise a lighter evening.`,
        `Good ${part}, sir. We are approaching the comfort limit. A touch of caution, perhaps.`,
      ],
      High: [
        `Good ${part}, sir. Your weekly load is running hot. I recommend trimming a commitment or two.`,
        `Good ${part}, sir. The schedule is strained. Rest is not optional, sir.`,
      ],
      Critical: [
        `Good ${part}, sir. I must be frank: the system is in the red. We act today.`,
        `Good ${part}, sir. More hours than the week contains... inventive, but unsustainable. Shall we fix it?`,
        `Good ${part}, sir. Critical load detected. I strongly advise an immediate review, sir.`,
      ],
    };
    const pool = pools[risk.label] || pools.Low;
    const line = pool[Math.floor(Math.random() * pool.length)];

    let done = false;
    const speakNow = () => {
      if (done) return;
      done = true;
      jarvisSpeak(line, 'en', undefined, localStorage.getItem('aql-voice') || 'en-GB-RyanNeural');
    };

    const t = setTimeout(speakNow, 1200);
    window.addEventListener('pointerdown', speakNow, { once: true });
    window.addEventListener('keydown', speakNow, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', speakNow);
      window.removeEventListener('keydown', speakNow);
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
    <BrainCore riskL={risk.label} load={totalHours ? highHours / totalHours : 0.3} rest={remaining / 168} thinking={busy} />
      <div style={{ textAlign: 'center', marginBottom: '0.5rem', fontFamily: 'Orbitron, Tajawal', fontSize: '0.72rem', letterSpacing: '0.3em', color: risk.color, textShadow: `0 0 14px ${risk.color}` }}>
        {lang === 'ar'
          ? `حالة النظام: ${risk.label === 'Low' ? 'مستقر' : risk.label === 'Medium' ? 'متوتر' : 'حرج'}`
          : `SYSTEM: ${risk.label === 'Low' ? 'STABLE' : risk.label === 'Medium' ? 'STRAINED' : 'CRITICAL'}`}
      </div>
      <HoloDecor />
      <div className="glass-panel hud-panel" style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', justifyItems: 'center' }}>
        <Gauge value={commitments.length} max={10} label={t('الالتزامات النشطة')} color="#00e5ff" />
        <Gauge value={totalHours} max={168} label={t('ساعات ملتزم بها')} color="#2979ff" suffix={hs} />
        <Gauge value={remaining} max={168} label={t('المتبقي للراحة')} color="#00e676" suffix={hs} />
        <Gauge value={riskPct} max={100} label={t('مستوى الخطر الحالي')} color={risk.color} suffix="%" />
      </div>

      <DirectivePanel />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        <div className="glass-panel hud-panel" style={{ padding: '1.2rem' }}>
          <h3 style={{ marginTop: 0, color: 'var(--text)', fontSize: '1rem' }}>◤ {t('توزيع الأنواع')}</h3>
          {totalHours === 0 ? <p style={{ color: 'var(--muted)', textAlign: 'center' }}>{t('لا توجد بيانات بعد — ابدأ بإضافة التزامات من غرفة التحقيق.')}</p> : <Donut data={typeData} hs={hs} />}
        </div>
        <div className="glass-panel hud-panel" style={{ padding: '1.2rem' }}>
          <h3 style={{ marginTop: 0, color: 'var(--text)', fontSize: '1rem', textAlign: 'center' }}>◈ {t('بصمة التوازن')}</h3>
          <Radar axes={radarAxes} />
        </div>
        <div className="glass-panel hud-panel" style={{ padding: '1.2rem' }}>
          <h3 style={{ marginTop: 0, color: 'var(--text)', fontSize: '1rem', textAlign: 'center' }}>▲ {t('نبض الفترات')}</h3>
          <VBars data={slotData} hs={hs} />
        </div>
      </div>

      <button onClick={goInvestigate} style={{ width: '100%', padding: '14px', background: 'linear-gradient(90deg, #0077ff, #00e5ff)', color: '#001018', border: 'none', borderRadius: '3px', fontSize: '1.05rem', fontWeight: 800, cursor: 'pointer', boxShadow: '0 0 25px rgba(0,229,255,0.35)' }}>
        ⌖ {t('بدء تحليل جديد')}
      </button>
    </div>
  );
}

/* ========== غرفة التحليل ========== */
function InvestigatePage({ commitments, onSaved }) {
  const { lang } = useLang();
  const [newCommitment, setNewCommitment] = useState(emptyCommitment);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const runInvestigation = async () => {
    setError(''); setSuccess('');
    if (!newCommitment.title.trim()) { setError('اكتب اسم الالتزام أولاً.'); return; }
    if (!newCommitment.hours_per_week || newCommitment.hours_per_week <= 0) { setError('عدد الساعات لازم يكون أكبر من صفر.'); return; }
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/simulate`, {
        method: 'POST', headers,
        body: JSON.stringify({ currentCommitments: commitments, newCommitment, lang }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'حدث خطأ أثناء المحاكاة');
      setResult(data.simulation_results);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const saveDecision = async () => {
    setError(''); setSuccess(''); setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/commitments`, { method: 'POST', headers, body: JSON.stringify(newCommitment) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر الحفظ');
      await onSaved();
      setSuccess('✅ تم حفظ القرار في قاعدة البيانات بنجاح.');
      setResult(null);
      setNewCommitment(emptyCommitment);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const riskColor = result ? (result.burnout_risk === 'Critical' ? '#ef4444' : result.burnout_risk === 'Low' ? '#10b981' : '#f59e0b') : '#10b981';

  return (
    <div>
      {error && <div className="glass-panel" style={{ padding: '1rem 1.2rem', marginBottom: '1.2rem', borderColor: 'rgba(239,68,68,0.4)', color: '#fecaca' }}>⚠️ {error}</div>}
      {success && <div className="glass-panel" style={{ padding: '1rem 1.2rem', marginBottom: '1.2rem', borderColor: 'rgba(16,185,129,0.4)', color: '#bbf7d0' }}>{success}</div>}

      <div className="glass-panel hud-panel" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0, color: '#f8fafc', fontSize: '1.2rem' }}>📝 اختبر قراراً جديداً (إضافة التزام):</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.2rem', marginTop: '1.2rem' }}>
          <div><label style={labelStyle}>اسم الالتزام</label>
            <input type="text" value={newCommitment.title} onChange={(e) => setNewCommitment({ ...newCommitment, title: e.target.value })} placeholder="مثال: عمل حر، دراسة..." style={fieldStyle} /></div>
          <div><label style={labelStyle}>الساعات أسبوعياً</label>
            <input type="number" min="1" max="168" value={newCommitment.hours_per_week} onChange={(e) => setNewCommitment({ ...newCommitment, hours_per_week: Number(e.target.value) })} style={fieldStyle} /></div>
          <div><label style={labelStyle}>نوع الالتزام</label>
            <select value={newCommitment.type} onChange={(e) => setNewCommitment({ ...newCommitment, type: e.target.value })} style={fieldStyle}>
              <option value="study">دراسة</option><option value="work">عمل</option><option value="health">صحة</option><option value="personal">شخصي</option><option value="sleep">نوم</option>
            </select></div>
          <div><label style={labelStyle}>الفترة الزمنية</label>
            <select value={newCommitment.timeSlot} onChange={(e) => setNewCommitment({ ...newCommitment, timeSlot: e.target.value })} style={fieldStyle}>
              <option value="morning">صباحي</option><option value="afternoon">ظهراً</option><option value="evening">مسائي</option><option value="late_night">ليل متأخر</option>
            </select></div>
          <div><label style={labelStyle}>الحمل الذهني</label>
            <select value={newCommitment.intensity} onChange={(e) => setNewCommitment({ ...newCommitment, intensity: e.target.value })} style={fieldStyle}>
              <option value="high">عالٍ جداً</option><option value="medium">متوسط</option><option value="low">خفيف</option>
            </select></div>
          <div><label style={labelStyle}>المرونة</label>
            <select value={newCommitment.flexible ? 'flexible' : 'rigid'} onChange={(e) => setNewCommitment({ ...newCommitment, flexible: e.target.value === 'flexible' })} style={fieldStyle}>
              <option value="flexible">مرن</option><option value="rigid">صارم</option>
            </select></div>
        </div>
        <button onClick={runInvestigation} disabled={loading} style={{ width: '100%', padding: '14px', background: 'linear-gradient(90deg,#0284c7,#6366f1)', color: 'white', border: 'none', borderRadius: '10px', fontSize: '1.1rem', fontWeight: '700', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '1.5rem', boxShadow: '0 4px 20px rgba(99,102,241,0.4)' }}>
          {loading ? '⚡ جاري المعالجة وتحليل الخيوط...' : '🔍 تشغيل محاكاة المحقق'}
        </button>
      </div>

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <BrainPanels result={result} />
          <div className="glass-panel hud-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '0.9rem', color: '#cbd5e1', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span>📊 الميزانية الأسبوعية (168 ساعة)</span>
              <span>المستخدم: <strong>{result.projected_total}س</strong> / المتبقي: <strong>{Math.max(result.remaining_hours, 0)}س</strong></span>
            </div>
            <div style={{ width: '100%', height: '14px', background: '#0f172a', borderRadius: '10px', overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: barWidth(result.current_hours), background: '#38bdf8', height: '100%' }} />
              <div style={{ width: barWidth(result.added_hours), background: '#f59e0b', height: '100%' }} />
              <div style={{ width: barWidth(Math.max(result.remaining_hours, 0)), background: 'rgba(255,255,255,0.05)', height: '100%' }} />
            </div>
          </div>

          <div className="glass-panel glass-panel-glow deduction-panel" style={{ padding: '1.8rem', borderColor: riskColor }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#f8fafc' }}>💡 استنتاج عَقْل:</span>
              <span style={{ padding: '6px 16px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: '800', backgroundColor: riskColor, color: '#0f172a' }}>الخطر: {result.burnout_risk}</span>
            </div>
            <p style={{ fontSize: '1.15rem', lineHeight: '1.7', color: '#f1f5f9', fontStyle: 'italic', margin: 0 }}>"{result.main_insight}"</p>
            <button onClick={saveDecision} disabled={saving} style={{ width: '100%', padding: '13px', background: result.burnout_risk === 'Critical' ? 'linear-gradient(90deg,#dc2626,#b91c1c)' : 'linear-gradient(90deg,#059669,#10b981)', color: 'white', border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', marginTop: '1.2rem' }}>
              {saving ? '⏳ جاري حفظ القرار...' : '💾 حفظ القرار النهائي'}
            </button>
          </div>

          <div className="glass-panel hud-panel" style={{ padding: '1.8rem' }}>
            <h4 style={{ marginTop: 0, color: '#38bdf8', fontSize: '1.1rem' }}>📌 الأدلة السلوكية المخفية:</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              {result.deductions.map((item, index) => (
                <div key={index} style={{ background: 'rgba(15,23,42,0.8)', padding: '1rem 1.2rem', borderRadius: '10px', borderRight: '4px solid #38bdf8', color: '#e2e8f0', lineHeight: 1.6 }}>{item}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== وحدات الوقت ========== */
function CommitmentsPage({ commitments, refresh }) {
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditForm({ title: item.title, hours_per_week: item.hours_per_week, type: item.type, intensity: item.intensity, timeSlot: item.timeSlot, flexible: item.flexible });
    setMessage(''); setError('');
  };

  const saveEdit = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/commitments/${editingId}`, { method: 'PATCH', headers, body: JSON.stringify(editForm) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر التعديل');
      await refresh();
      setEditingId(null); setEditForm(null);
      setMessage('✅ تم حفظ التعديلات.');
    } catch (err) { setError(err.message); }
  };

  const remove = async (id) => {
    if (!window.confirm('هل تريد حذف هذا الالتزام من ملف القضية؟')) return;
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/commitments/${id}`, { method: 'DELETE', headers });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر الحذف');
      await refresh();
      setMessage('🗑️ تم حذف الالتزام.');
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      {error && <div className="glass-panel" style={{ padding: '1rem 1.2rem', marginBottom: '1.2rem', borderColor: 'rgba(239,68,68,0.4)', color: '#fecaca' }}>⚠️ {error}</div>}
      {message && <div className="glass-panel" style={{ padding: '1rem 1.2rem', marginBottom: '1.2rem', borderColor: 'rgba(16,185,129,0.4)', color: '#bbf7d0' }}>{message}</div>}
      {commitments.length === 0 ? (
        <div className="glass-panel hud-panel" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>لا توجد التزامات محفوظة. اذهب لغرفة التحليل وأضف أول قرار. 🔍</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {commitments.map((item) => (
            <div key={item.id} className="glass-panel" style={{ padding: '1rem 1.2rem' }}>
              {editingId === item.id ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.8rem' }}>
                  <div><label style={labelStyle}>الاسم</label><input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} style={fieldStyle} /></div>
                  <div><label style={labelStyle}>الساعات</label><input type="number" min="1" max="168" value={editForm.hours_per_week} onChange={(e) => setEditForm({ ...editForm, hours_per_week: Number(e.target.value) })} style={fieldStyle} /></div>
                  <div><label style={labelStyle}>النوع</label>
                    <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} style={fieldStyle}>
                      <option value="study">دراسة</option><option value="work">عمل</option><option value="health">صحة</option><option value="personal">شخصي</option><option value="sleep">نوم</option>
                    </select></div>
                  <div><label style={labelStyle}>الفترة</label>
                    <select value={editForm.timeSlot} onChange={(e) => setEditForm({ ...editForm, timeSlot: e.target.value })} style={fieldStyle}>
                      <option value="morning">صباحي</option><option value="afternoon">ظهراً</option><option value="evening">مسائي</option><option value="late_night">ليل متأخر</option>
                    </select></div>
                  <div><label style={labelStyle}>الحمل</label>
                    <select value={editForm.intensity} onChange={(e) => setEditForm({ ...editForm, intensity: e.target.value })} style={fieldStyle}>
                      <option value="high">عالٍ</option><option value="medium">متوسط</option><option value="low">خفيف</option>
                    </select></div>
                  <div><label style={labelStyle}>المرونة</label>
                    <select value={editForm.flexible ? 'flexible' : 'rigid'} onChange={(e) => setEditForm({ ...editForm, flexible: e.target.value === 'flexible' })} style={fieldStyle}>
                      <option value="flexible">مرن</option><option value="rigid">صارم</option>
                    </select></div>
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'end' }}>
                    <button onClick={saveEdit} style={{ flex: 1, padding: '10px', background: 'linear-gradient(90deg,#059669,#10b981)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' }}>💾 حفظ</button>
                    <button onClick={() => { setEditingId(null); setEditForm(null); }} style={{ padding: '10px 14px', background: 'rgba(148,163,184,0.1)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.3)', borderRadius: '8px', cursor: 'pointer' }}>إلغاء</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ color: '#f8fafc', fontWeight: '700' }}>{item.title}</div>
                    <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '4px' }}>
                      {item.hours_per_week} ساعة | {typeLabels[item.type] || item.type} | حمل: {item.intensity} | فترة: {item.timeSlot}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', padding: '5px 12px', borderRadius: '999px', border: '1px solid rgba(56,189,248,0.25)', color: '#38bdf8' }}>{item.flexible ? 'مرن' : 'صارم'}</span>
                    <button onClick={() => startEdit(item)} style={{ fontSize: '0.8rem', padding: '5px 12px', borderRadius: '999px', border: '1px solid rgba(56,189,248,0.35)', background: 'rgba(56,189,248,0.1)', color: '#7dd3fc', cursor: 'pointer', fontWeight: '700' }}>تعديل ✏️</button>
                    <button onClick={() => remove(item.id)} style={{ fontSize: '0.8rem', padding: '5px 12px', borderRadius: '999px', border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', cursor: 'pointer', fontWeight: '700' }}>حذف 🗑️</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ========== سجل التحليلات ========== */
function HistoryPage() {
  const [logs, setLogs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_URL}/api/analysis-logs`, { headers });
        const json = await response.json();
        if (response.ok) setLogs(json.logs || []);
      } catch (err) { /* تجاهل */ }
      setLoaded(true);
    })();
  }, []);
  if (!loaded) return <p style={{ color: '#94a3b8' }}>⏳ جاري فتح الأرشيف...</p>;
  if (logs.length === 0) return <div className="glass-panel hud-panel" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>الأرشيف فارغ. شغّل أول محاكاة من غرفة التحليل. 🔍</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      {logs.map((log) => (
        <div key={log.id} className="glass-panel" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '6px' }}>
            <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{new Date(log.created_at).toLocaleString('ar-SA')}</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, padding: '3px 10px', borderRadius: '999px', background: log.burnout_risk === 'Critical' ? 'rgba(239,68,68,0.15)' : log.burnout_risk === 'Low' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)', color: log.burnout_risk === 'Critical' ? '#fca5a5' : log.burnout_risk === 'Low' ? '#6ee7b7' : '#fcd34d' }}>الخطر: {log.burnout_risk}</span>
          </div>
          <p style={{ margin: 0, color: '#e2e8f0', fontSize: '1.05rem', lineHeight: 1.7 }}>{log.main_insight}</p>
        </div>
      ))}
    </div>
  );
}

/* ========== الهوية ========== */
function ProfilePage({ displayName, email, onLogout }) {
  const card = { padding: '1.2rem', borderRadius: '14px', background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.06)' };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
      <div style={card}><div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>الاسم</div><div style={{ color: '#f8fafc', fontSize: '1.3rem', fontWeight: 800 }}>🕵️ {displayName}</div></div>
      <div style={card}><div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>البريد</div><div style={{ color: '#7dd3fc', fontSize: '1rem', fontWeight: 700, wordBreak: 'break-all' }}>{email}</div></div>
      <div style={card}><div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>الميزانية الأسبوعية</div><div style={{ color: '#38bdf8', fontSize: '1.3rem', fontWeight: 800 }}>168 ساعة</div></div>
      <div style={card}><div style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '8px' }}>الجلسة</div>
        <button onClick={onLogout} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#fecaca', borderRadius: '999px', padding: '8px 16px', cursor: 'pointer', fontWeight: '700' }}>تسجيل الخروج ⎋</button></div>
    </div>
  );
}

/* ========== اتصال مباشر ========== */
function ChatPage() {
  const { lang } = useLang();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [voiceName, setVoiceName] = useState(() => localStorage.getItem('aql-voice') || 'en-GB-RyanNeural');

  useEffect(() => {
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_URL}/api/chat`, { headers });
        const json = await response.json();
        if (response.ok) setMessages(json.messages || []);
      } catch (err) { /* نتجاهل */ }
    })();
  }, []);

  useEffect(() => {
    const el = document.getElementById('chat-bottom');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const speak = (text, id) => { setSpeakingId(id); jarvisSpeak(text, lang, () => setSpeakingId(null), voiceName); };
  const stopSpeaking = () => { jarvisStop(); setSpeakingId(null); };

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setError('متصفحك لا يدعم الأوامر الصوتية — جرّب Chrome.'); return; }
    stopSpeaking();
    const rec = new SR();
    rec.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => { const text = e.results[0][0].transcript; setInput(text); sendText(text); };
    rec.onerror = () => { setError('تعذر سماع صوتك، حاول مجددًا.'); setListening(false); };
    rec.onend = () => setListening(false);
    setListening(true);
    try { rec.start(); } catch (err) { setListening(false); }
  };

  const sendText = async (text) => {
    if (!text || busy) return;
    setBusy(true); setError('');
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/chat`, { method: 'POST', headers, body: JSON.stringify({ message: text, lang }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'تعذر إرسال الرسالة');
      const replyId = `live-${Date.now()}`;
      setMessages((m) => [...m, { role: 'assistant', content: json.reply, id: replyId }]);
      if (autoSpeak) speak(json.reply, replyId);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const send = (e) => { e.preventDefault(); sendText(input.trim()); };

  return (
    <div className="glass-panel hud-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', height: '70vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="baseer-avatar" style={{ width: '44px', height: '44px' }}><span style={{ fontSize: '1.2rem' }}>🧠</span></div>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#f8fafc', fontWeight: 800 }}>قناة اتصال مباشرة</div>
          <div style={{ color: '#64748b', fontSize: '0.8rem' }}>تكلّم معه أو اكتب — وهو يرد عليك صوتيًا</div>
        </div>
        <select
          value={voiceName}
          onChange={(e) => { setVoiceName(e.target.value); localStorage.setItem('aql-voice', e.target.value); }}
          style={{ ...fieldStyle, width: '170px' }}
        >
          <option value="en-GB-RyanNeural">🎩 Ryan — British Butler</option>
          <option value="en-GB-ThomasNeural">🌑 Thomas — Deep Calm</option>
          <option value="en-US-ChristopherNeural">⚙️ Christopher — US Calm</option>
          <option value="en-GB-SoniaNeural">🕵️ Sonia — Female Intel</option>
        </select>
        <button type="button" onClick={() => speak(lang === 'ar' ? 'مرحبًا يا سيدي، أنا عَقْل. كيف أخدمك اليوم؟' : 'At your service, sir.', 'test')}
          style={{ padding: '7px 14px', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.35)', color: '#c4b5fd' }}>
          🔊 جرّب الصوت
        </button>
        <button onClick={() => { setAutoSpeak(!autoSpeak); if (autoSpeak) stopSpeaking(); }}
          style={{ padding: '7px 14px', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer', border: autoSpeak ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(148,163,184,0.25)', background: autoSpeak ? 'rgba(16,185,129,0.12)' : 'rgba(148,163,184,0.08)', color: autoSpeak ? '#6ee7b7' : '#94a3b8' }}>
          {autoSpeak ? '🔊 الصوت: مفعّل' : '🔇 الصوت: مطفأ'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.8rem', padding: '0.5rem' }}>
        {messages.length === 0 && (
          <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: '2rem', lineHeight: 1.8 }}>
            🕵️ عَقْل: "ملفك مفتوح أمامي... اضغط المايك وتكلم، أو اكتب سؤالك، وسأرد عليك صوتيًا."
          </p>
        )}
        {messages.map((m, i) => {
          const mid = m.id || i;
          return (
            <div key={mid} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%', padding: '0.8rem 1rem', borderRadius: '14px', background: m.role === 'user' ? 'rgba(56,189,248,0.12)' : 'rgba(139,92,246,0.12)', border: `1px solid ${m.role === 'user' ? 'rgba(56,189,248,0.3)' : 'rgba(139,92,246,0.3)'}`, color: '#e2e8f0', lineHeight: 1.7, fontSize: '1.05rem', whiteSpace: 'pre-wrap' }}>
              <span data-skip-i18n="1">{m.content}</span>
              {m.role === 'assistant' && (
                <div style={{ marginTop: '6px' }}>
                  <button onClick={() => (speakingId === mid ? stopSpeaking() : speak(m.content, mid))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: speakingId === mid ? '#4ade80' : '#94a3b8', fontSize: '0.8rem', fontWeight: 700 }}>
                    {speakingId === mid ? '⏸️ إيقاف' : '🔊 استمع'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {busy && <div style={{ alignSelf: 'flex-start', color: '#94a3b8', fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}>⚡ عَقْل يفكر...</div>}
        <div id="chat-bottom" />
      </div>

      {error && <div style={{ color: '#fecaca', fontSize: '0.85rem', margin: '0.5rem 0' }}>⚠️ {error}</div>}

      <form onSubmit={send} style={{ display: 'flex', gap: '0.8rem', marginTop: '0.8rem' }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="اكتب رسالتك... أو اضغط المايك وتكلم" style={{ ...fieldStyle, flex: 1, fontSize: '1.1rem' }} />
        <button type="button" onClick={startListening} disabled={busy || listening} title="تكلّم مع عَقْل"
          style={{ padding: '12px 16px', background: listening ? 'rgba(239,68,68,0.2)' : 'rgba(56,189,248,0.1)', border: `1px solid ${listening ? 'rgba(239,68,68,0.5)' : 'rgba(56,189,248,0.35)'}`, color: listening ? '#fca5a5' : '#7dd3fc', borderRadius: '10px', cursor: 'pointer', fontSize: '1.1rem', boxShadow: listening ? '0 0 18px rgba(239,68,68,0.4)' : 'none' }}>
          {listening ? '🎙️ أسمعك...' : '🎤'}
        </button>
        <button type="submit" disabled={busy || !input.trim()}
          style={{ padding: '12px 26px', fontSize: '1.05rem', background: 'linear-gradient(90deg,#0284c7,#6366f1)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: busy || !input.trim() ? 'not-allowed' : 'pointer', opacity: busy || !input.trim() ? 0.6 : 1 }}>
          إرسال 📨
        </button>
      </form>
    </div>
  );
}

/* ========== الأهداف الاستراتيجية ========== */
function GoalsPage() {
  const [goals, setGoals] = useState([]);
  const [commitments, setCommitments] = useState([]);
  const [title, setTitle] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDate, setEditDate] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const [gRes, cRes] = await Promise.all([fetch(`${API_URL}/api/goals`, { headers }), fetch(`${API_URL}/api/commitments`, { headers })]);
      const gJson = await gRes.json();
      const cJson = await cRes.json();
      if (gRes.ok) setGoals(gJson.goals || []);
      if (cRes.ok) setCommitments(cJson.commitments || []);
    } catch (err) { setError(err.message); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const addGoal = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/goals`, { method: 'POST', headers, body: JSON.stringify({ title, target_date: targetDate || null }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'تعذر إضافة الهدف');
      setMessage('✅ تمت إضافة الهدف.');
      setTitle(''); setTargetDate('');
      await fetchAll();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const saveEdit = async (id) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/goals/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ title: editTitle, target_date: editDate || null }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'تعذر التعديل');
      setMessage('✅ تم حفظ التعديلات.');
      setEditingId(null);
      await fetchAll();
    } catch (err) { setError(err.message); }
  };

  const removeGoal = async (id) => {
    if (!window.confirm('حذف الهدف؟ الالتزامات المرتبطة به لن تُحذف، فقط يُفصل ربطها.')) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/goals/${id}`, { method: 'DELETE', headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'تعذر الحذف');
      setMessage('🗑️ تم حذف الهدف.');
      await fetchAll();
    } catch (err) { setError(err.message); }
  };

  const link = async (goalId, commitmentId) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/commitments/${commitmentId}`, { method: 'PATCH', headers, body: JSON.stringify({ goal_id: goalId }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'تعذر الربط');
      setMessage('🔗 تم ربط الالتزام بالهدف.');
      await fetchAll();
    } catch (err) { setError(err.message); }
  };

  const unlink = async (commitmentId) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/commitments/${commitmentId}`, { method: 'PATCH', headers, body: JSON.stringify({ goal_id: null }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'تعذر الفصل');
      setMessage('↩️ تم فصل الالتزام.');
      await fetchAll();
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      {error && <div className="glass-panel" style={{ padding: '1rem 1.2rem', marginBottom: '1.2rem', borderColor: 'rgba(239,68,68,0.4)', color: '#fecaca' }}>⚠️ {error}</div>}
      {message && <div className="glass-panel" style={{ padding: '1rem 1.2rem', marginBottom: '1.2rem', borderColor: 'rgba(16,185,129,0.4)', color: '#bbf7d0' }}>{message}</div>}
      <form onSubmit={addGoal} className="glass-panel hud-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0, color: '#f8fafc' }}>🎯 أضف هدفًا جديدًا</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          <div><label style={labelStyle}>اسم الهدف</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: إطلاق مشروعي، حفظ القرآن..." style={fieldStyle} /></div>
          <div><label style={labelStyle}>تاريخ الاستهداف (اختياري)</label>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} style={fieldStyle} /></div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" disabled={busy || !title.trim()} style={{ width: '100%', padding: '11px', background: 'linear-gradient(90deg,#0284c7,#6366f1)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: busy || !title.trim() ? 'not-allowed' : 'pointer' }}>➕ إضافة الهدف</button>
          </div>
        </div>
      </form>

      {goals.length === 0 ? (
        <div className="glass-panel hud-panel" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>لا توجد أهداف بعد. أضف هدفك الأول وابدأ بربط التزاماتك به. 🎯</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
          {goals.map((g) => {
            const linked = commitments.filter((c) => c.goal_id === g.id);
            const free = commitments.filter((c) => !c.goal_id);
            const linkedHours = linked.reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
            const daysLeft = g.target_date ? Math.ceil((new Date(g.target_date) - new Date()) / 86400000) : null;
            return (
              <div key={g.id} className="glass-panel hud-panel" style={{ padding: '1.4rem' }}>
                {editingId === g.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={fieldStyle} />
                    <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} style={fieldStyle} />
                    <div style={{ display: 'flex', gap: '0.6rem' }}>
                      <button onClick={() => saveEdit(g.id)} style={{ flex: 1, padding: '10px', background: 'linear-gradient(90deg,#059669,#10b981)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' }}>💾 حفظ</button>
                      <button onClick={() => setEditingId(null)} style={{ padding: '10px 14px', background: 'rgba(148,163,184,0.1)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.3)', borderRadius: '8px', cursor: 'pointer' }}>إلغاء</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                      <div style={{ color: '#f8fafc', fontWeight: 800, fontSize: '1.1rem' }}>🎯 {g.title}</div>
                      {daysLeft !== null && (
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, padding: '4px 10px', borderRadius: '999px', background: daysLeft <= 7 ? 'rgba(239,68,68,0.15)' : daysLeft <= 30 ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)', color: daysLeft <= 7 ? '#fca5a5' : daysLeft <= 30 ? '#fcd34d' : '#6ee7b7' }}>
                          {daysLeft < 0 ? 'انتهى الموعد' : `باقي ${daysLeft} يوم`}
                        </span>
                      )}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '0.6rem' }}>تستثمر فيه: <strong style={{ color: '#38bdf8' }}>{linkedHours}س/أسبوع</strong> عبر <strong>{linked.length}</strong> التزام</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '0.8rem' }}>
                      {linked.map((c) => (
                        <span key={c.id} style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '999px', border: '1px solid rgba(56,189,248,0.3)', color: '#7dd3fc', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          {c.title}
                          <button onClick={() => unlink(c.id)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: 0, fontSize: '0.8rem' }}>✕</button>
                        </span>
                      ))}
                      {linked.length === 0 && <span style={{ color: '#64748b', fontSize: '0.8rem' }}>لا التزامات مرتبطة بعد.</span>}
                    </div>
                    {free.length > 0 && (
                      <select defaultValue="" onChange={(e) => { if (e.target.value) link(g.id, e.target.value); }} style={{ ...fieldStyle, marginTop: '0.9rem' }}>
                        <option value="">🔗 اربط التزامًا بهذا الهدف...</option>
                        {free.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                      </select>
                    )}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '1rem' }}>
                      <button onClick={() => { setEditingId(g.id); setEditTitle(g.title); setEditDate(g.target_date || ''); }} style={{ fontSize: '0.8rem', padding: '5px 12px', borderRadius: '999px', border: '1px solid rgba(56,189,248,0.35)', background: 'rgba(56,189,248,0.1)', color: '#7dd3fc', cursor: 'pointer', fontWeight: '700' }}>تعديل ✏️</button>
                      <button onClick={() => removeGoal(g.id)} style={{ fontSize: '0.8rem', padding: '5px 12px', borderRadius: '999px', border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', cursor: 'pointer', fontWeight: '700' }}>حذف 🗑️</button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ========== رسم المسار ========== */
function buildSmoothPath(points) {
  if (!points.length) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const cx = (p0.x + p1.x) / 2;
    d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

function balanceScore(commitments) {
  const total = commitments.reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
  const high = commitments.filter((c) => c.intensity === 'high').reduce((s, c) => s + Number(c.hours_per_week), 0);
  const rigid = commitments.filter((c) => !c.flexible).reduce((s, c) => s + Number(c.hours_per_week), 0);
  const late = commitments.filter((c) => c.timeSlot === 'late_night').reduce((s, c) => s + Number(c.hours_per_week), 0);
  let score = 90;
  if (total > 90) score -= 25; else if (total > 75) score -= 15; else if (total > 60) score -= 8;
  if (high > 35) score -= 15;
  if (rigid > 65) score -= 15;
  if (late > 10) score -= 10;
  return Math.max(10, Math.min(95, score));
}

function ProjectionChart({ commitments }) {
  const W = 720, H = 280, PAD = 40, steps = 14;
  const score = balanceScore(commitments);
  const currentPoints = [], simPoints = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = PAD + t * (W - PAD * 2);
    const decline = (70 - Math.min(score, 70)) * 0.4 + 12;
    const curScore = Math.max(8, score - decline * t * t);
    const target = Math.min(score + 22, 93);
    const simScore = score + (target - score) * (1 - Math.pow(1 - t, 2));
    currentPoints.push({ x, y: H - PAD - (curScore / 100) * (H - PAD * 2) });
    simPoints.push({ x, y: H - PAD - (simScore / 100) * (H - PAD * 2) });
  }
  const dCur = buildSmoothPath(currentPoints);
  const dSim = buildSmoothPath(simPoints);
  const lastSim = simPoints[simPoints.length - 1];
  const baseY = H - PAD - (score / 100) * (H - PAD * 2);

  return (
    <div className="glass-panel hud-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '0.8rem' }}>
        <h3 style={{ margin: 0, color: '#f8fafc' }}>🔮 إسقاط المسار المستقبلي (محاكاة سنة)</h3>
        <div style={{ display: 'flex', gap: '14px', fontSize: '0.8rem', color: '#94a3b8', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '16px', height: '3px', background: '#f97316', borderRadius: '2px' }}></span> المسار الحالي</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '16px', height: '3px', background: '#22c55e', borderRadius: '2px' }}></span> المسار بعد توصيات عَقْل</span>
        </div>
      </div>
      <div style={{ direction: 'ltr' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          {[0.25, 0.5, 0.75].map((g) => (<line key={g} x1={PAD} x2={W - PAD} y1={PAD + g * (H - PAD * 2)} y2={PAD + g * (H - PAD * 2)} stroke="rgba(148,163,184,0.08)" strokeWidth="1" />))}
          {[0, 0.5, 1].map((t) => (<line key={t} x1={PAD + t * (W - PAD * 2)} x2={PAD + t * (W - PAD * 2)} y1={PAD} y2={H - PAD} stroke="rgba(148,163,184,0.12)" strokeWidth="1" strokeDasharray="4 6" />))}
          <line x1={PAD} x2={W - PAD} y1={baseY} y2={baseY} stroke="rgba(248,250,252,0.25)" strokeWidth="1" strokeDasharray="6 6" />
          <path d={dCur} fill="none" stroke="#f97316" strokeWidth="3" className="path-animate" style={{ filter: 'drop-shadow(0 0 6px rgba(249,115,22,0.6))' }} />
          <path d={dSim} fill="none" stroke="#22c55e" strokeWidth="3" className="path-animate" style={{ filter: 'drop-shadow(0 0 8px rgba(34,197,94,0.7))' }} />
          <circle cx={currentPoints[0].x} cy={currentPoints[0].y} r="5" fill="#f8fafc" />
          <circle cx={lastSim.x} cy={lastSim.y} r="8" fill="none" stroke="#22c55e" strokeWidth="2" opacity="0.5" />
          <circle cx={lastSim.x} cy={lastSim.y} r="4" fill="#22c55e" style={{ filter: 'drop-shadow(0 0 10px #22c55e)' }} />
          <text x={currentPoints[0].x + 10} y={currentPoints[0].y + 18} fill="#fdba74" fontSize="13" fontWeight="700">المسار الحالي</text>
          <text x={lastSim.x - 170} y={lastSim.y - 14} fill="#4ade80" fontSize="13" fontWeight="800">الهدف متحقق 🎯</text>
          <text x={PAD} y={H - 12} fill="#64748b" fontSize="11">اليوم</text>
          <text x={W / 2 - 18} y={H - 12} fill="#64748b" fontSize="11">٦ أشهر</text>
          <text x={W - PAD - 28} y={H - 12} fill="#64748b" fontSize="11">سنة</text>
        </svg>
      </div>
      <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '0.8rem', lineHeight: 1.7 }}>
        🟠 الخط البرتقالي: استمرار نمطك الحالي كما هو دون تغيير. 🟢 الخط الأخضر: مسارك المتوقع إذا طبّقت توصيات عَقْل هذا الأسبوع.
      </p>
    </div>
  );
}

/* ========== التقارير الحيوية ========== */
function ReportsPage() {
  const [commitments, setCommitments] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const { t, hs } = useLang();

  useEffect(() => {
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const [cRes, lRes] = await Promise.all([fetch(`${API_URL}/api/commitments`, { headers }), fetch(`${API_URL}/api/analysis-logs`, { headers })]);
        const cJson = await cRes.json();
        const lJson = await lRes.json();
        if (cRes.ok) setCommitments(cJson.commitments || []);
        if (lRes.ok) setLogs(lJson.logs || []);
      } catch (err) { /* نتجاهل */ }
      setLoaded(true);
    })();
  }, []);

  if (!loaded) return <p style={{ color: '#94a3b8' }}>⏳ جاري تجهيز التقارير...</p>;

  const totalHours = commitments.reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
  const highHours = commitments.filter((c) => c.intensity === 'high').reduce((s, c) => s + Number(c.hours_per_week), 0);
  const rigidHours = commitments.filter((c) => !c.flexible).reduce((s, c) => s + Number(c.hours_per_week), 0);
  const remaining = Math.max(168 - totalHours, 0);
  const risk = riskOf(totalHours);
  const riskPct = risk.label === 'Critical' ? 95 : risk.label === 'High' ? 70 : risk.label === 'Medium' ? 45 : 15;
  const trend = logs.slice(0, 10).reverse();

  const typeData = Object.keys(typeLabels).map((k) => ({
    label: t(typeLabels[k]),
    value: commitments.filter((c) => c.type === k).reduce((s, c) => s + Number(c.hours_per_week), 0),
    color: typeColors[k],
  }));
  const slotColors = { morning: '#00e5ff', afternoon: '#2979ff', evening: '#4dd8ff', late_night: '#ff4d4d', mixed: '#7d9bb8' };
  const slotData = Object.keys(slotLabels).map((k) => ({
    label: t(slotLabels[k]),
    value: commitments.filter((c) => c.timeSlot === k).reduce((s, c) => s + Number(c.hours_per_week), 0),
    color: slotColors[k],
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <ProjectionChart commitments={commitments} />
      <HoloDecor />
      <div className="glass-panel hud-panel" style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', justifyItems: 'center' }}>
        <Gauge value={totalHours} max={168} label={t('إجمالي الالتزامات:')} color="#2979ff" suffix={hs} />
        <Gauge value={highHours} max={Math.max(totalHours, 1)} label={t('حمل ذهني عالٍ:')} color="#ff9100" suffix={hs} />
        <Gauge value={rigidHours} max={Math.max(totalHours, 1)} label={t('ساعات صارمة:')} color="#ff2d78" suffix={hs} />
        <Gauge value={riskPct} max={100} label={t('مستوى الخطر:')} color={risk.color} suffix="%" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
        <div className="glass-panel hud-panel" style={{ padding: '1.2rem' }}>
          <h3 style={{ marginTop: 0, color: 'var(--text)', fontSize: '1rem' }}>◤ {t('توزيع الأنواع')}</h3>
          {totalHours === 0 ? <p style={{ color: 'var(--muted)', textAlign: 'center' }}>لا بيانات بعد.</p> : <Donut data={typeData} hs={hs} />}
        </div>
        <div className="glass-panel hud-panel" style={{ padding: '1.2rem' }}>
          <h3 style={{ marginTop: 0, color: 'var(--text)', fontSize: '1rem', textAlign: 'center' }}>▲ {t('نبض الفترات')}</h3>
          <VBars data={slotData} hs={hs} />
        </div>
      </div>

      <div className="glass-panel hud-panel" style={{ padding: '1.5rem' }}>
        <h3 style={{ marginTop: 0, color: 'var(--text)' }}>◉ {t('مسار الخطر عبر التحقيقات')}</h3>
        {trend.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>شغّل محاكاة أولاً ليبدأ سجل المخاطر بالتكوّن.</p>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', marginTop: '1rem' }}>
            {trend.map((log) => (
              <div key={log.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <div style={{
                  width: 34, height: 34, borderRadius: '50%',
                  border: `2px solid ${log.burnout_risk === 'Critical' ? '#ef4444' : log.burnout_risk === 'Low' ? '#00e676' : '#ff9100'}`,
                  boxShadow: `0 0 12px ${log.burnout_risk === 'Critical' ? '#ef4444' : log.burnout_risk === 'Low' ? '#00e676' : '#ff9100'}66`,
                  display: 'grid', placeItems: 'center',
                  fontSize: '0.55rem', fontFamily: 'Orbitron', color: 'var(--text)',
                }}>
                  {log.burnout_risk.slice(0, 4)}
                </div>
                <span style={{ color: 'var(--muted)', fontSize: '0.6rem' }}>{new Date(log.created_at).toLocaleDateString('ar-SA')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== شارات الأداء ========== */
function AchievementsPage() {
  const [data, setData] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const [cRes, gRes, lRes, chRes] = await Promise.all([
          fetch(`${API_URL}/api/commitments`, { headers }),
          fetch(`${API_URL}/api/goals`, { headers }),
          fetch(`${API_URL}/api/analysis-logs`, { headers }),
          fetch(`${API_URL}/api/chat`, { headers }),
        ]);
        const cJson = await cRes.json();
        const gJson = await gRes.json();
        const lJson = await lRes.json();
        const chJson = await chRes.json();
        const commitments = cRes.ok ? cJson.commitments || [] : [];
        const goals = gRes.ok ? gJson.goals || [] : [];
        const logs = lRes.ok ? lJson.logs || [] : [];
        const chat = chRes.ok ? chJson.messages || [] : [];
        const totalHours = commitments.reduce((s, c) => s + Number(c.hours_per_week || 0), 0);
        const morningHours = commitments.filter((c) => c.timeSlot === 'morning').reduce((s, c) => s + Number(c.hours_per_week), 0);
        const lateHours = commitments.filter((c) => c.timeSlot === 'late_night').reduce((s, c) => s + Number(c.hours_per_week), 0);
        setData({
          commitments, goals,
          logsCount: logs.length,
          chatCount: chat.filter((m) => m.role === 'user').length,
          linkedCount: commitments.filter((c) => c.goal_id).length,
          totalHours, morningHours, lateHours,
          hasFlexible: commitments.some((c) => c.flexible),
          hasRigid: commitments.some((c) => !c.flexible),
          risk: riskOf(totalHours).label,
        });
      } catch (err) {
        setData({ commitments: [], goals: [], logsCount: 0, chatCount: 0, linkedCount: 0, totalHours: 0, morningHours: 0, lateHours: 0, hasFlexible: false, hasRigid: false, risk: 'Low' });
      }
    })();
  }, []);

  if (!data) return <p style={{ color: '#94a3b8' }}>⏳ جاري فتح خزانة الأوسمة...</p>;

  const ACHIEVEMENTS = [
    { id: 'first_step', icon: '🌱', title: 'الخطوة الأولى', desc: 'أضفت أول التزام إلى ملف قضيتك.', check: (d) => d.commitments.length >= 1 },
    { id: 'planner', icon: '📅', title: 'مخطط منظم', desc: 'لديك ثلاثة التزامات نشطة أو أكثر.', check: (d) => d.commitments.length >= 3 },
    { id: 'visionary', icon: '🎯', title: 'صاحب رؤية', desc: 'أنشأت هدفًا يوجّه التزاماتك.', check: (d) => d.goals.length >= 1 },
    { id: 'strategist', icon: '🔗', title: 'عقل استراتيجي', desc: 'ربطت التزامًا واحدًا على الأقل بهدف.', check: (d) => d.linkedCount >= 1 },
    { id: 'detective', icon: '🕵️', title: 'عميل محقق', desc: 'شغّلت أول محاكاة وحصلت على استنتاج.', check: (d) => d.logsCount >= 1 },
    { id: 'baseer_friend', icon: '🧠', title: 'صديق عَقْل', desc: 'بدأت محادثة مباشرة مع عَقْل.', check: (d) => d.chatCount >= 1 },
    { id: 'balanced', icon: '🧘', title: 'روح متوازنة', desc: 'مستوى خطرك الحالي Low مع ميزانية مريحة.', check: (d) => d.risk === 'Low' && d.totalHours >= 20 },
    { id: 'early_bird', icon: '🌅', title: 'طائر الصباح', desc: 'تستثمر 10 ساعات أسبوعيًا أو أكثر في الفترة الصباحية.', check: (d) => d.morningHours >= 10 },
    { id: 'night_owl', icon: '🦉', title: 'بومة الليل', desc: 'لديك أكثر من 10 ساعات ليل متأخر — عَقْل يراقبك.', check: (d) => d.lateHours > 10 },
    { id: 'ambitious', icon: '🔥', title: 'طموح جامح', desc: 'تجاوزت 90 ساعة التزام أسبوعيًا — جرأة تستحق الوسام.', check: (d) => d.totalHours > 90 },
    { id: 'disciplined', icon: '💎', title: 'انضباط مرن', desc: 'تملك مزيجًا من الالتزامات المرنة والصارمة.', check: (d) => d.hasFlexible && d.hasRigid },
    { id: 'persistent', icon: '📈', title: 'محلل دائم', desc: 'أجريت خمسة تحليلات أو أكثر — ذاكرة قضيتك تكبر.', check: (d) => d.logsCount >= 5 },
  ];

  const earnedCount = ACHIEVEMENTS.filter((a) => a.check(data)).length;
  const pct = Math.round((earnedCount / ACHIEVEMENTS.length) * 100);

  return (
    <div>
      <div className="glass-panel hud-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem' }}>
          <h3 style={{ margin: 0, color: '#f8fafc' }}>🏆 خزانة أوسمة عَقْل</h3>
          <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>حققت <strong style={{ color: '#fbbf24' }}>{earnedCount}</strong> من <strong>{ACHIEVEMENTS.length}</strong> وسامًا</span>
        </div>
        <div style={{ width: '100%', height: '10px', background: '#0f172a', borderRadius: '8px', overflow: 'hidden', marginTop: '0.9rem' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#f59e0b,#fbbf24)', boxShadow: '0 0 12px rgba(251,191,36,0.6)' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        {ACHIEVEMENTS.map((a) => {
          const earned = a.check(data);
          return (
            <div key={a.id} className="glass-panel" style={{ padding: '1.3rem', textAlign: 'center', border: earned ? '1px solid rgba(251,191,36,0.45)' : '1px solid rgba(255,255,255,0.06)', boxShadow: earned ? '0 0 24px rgba(251,191,36,0.12)' : 'none', opacity: earned ? 1 : 0.55 }}>
              <div style={{ fontSize: '2.2rem', filter: earned ? 'drop-shadow(0 0 12px rgba(251,191,36,0.5))' : 'grayscale(1)', marginBottom: '0.6rem' }}>{earned ? a.icon : '🔒'}</div>
              <div style={{ color: earned ? '#fbbf24' : '#94a3b8', fontWeight: 800, fontSize: '1.05rem' }}>{a.title}</div>
              <p style={{ color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.7, margin: '0.5rem 0 0' }}>{a.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ========== صفحة Life OS ========== */
function LifeOSPage() {
  const { lang, hs } = useLang();
  const [tab, setTab] = useState('overview');
  const [finance, setFinance] = useState({ entries: [], summary: { income: 0, expense: 0, balance: 0 } });
  const [study, setStudy] = useState({ sessions: [], total_minutes: 0 });
  const [home, setHome] = useState({ tasks: [] });
  const [people, setPeople] = useState({ people: [] });
  const [wellness, setWellness] = useState({ logs: [] });
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [finForm, setFinForm] = useState({ type: 'expense', amount: '', category: lang === 'ar' ? 'طعام' : 'Food', note: '' });
  const [studyForm, setStudyForm] = useState({ subject: '', duration_minutes: 30, quality: 'medium' });
  const [homeForm, setHomeForm] = useState({ title: '', room: '', priority: 'medium' });
  const [relForm, setRelForm] = useState({ person_name: '', relation_type: 'family' });
  const [wellForm, setWellForm] = useState({ mood: 7, energy: 7, sleep_hours: 7 });

  const loadAll = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const [f, s, h, r, w] = await Promise.all([
        fetch(`${API_URL}/api/finance`, { headers }),
        fetch(`${API_URL}/api/study`, { headers }),
        fetch(`${API_URL}/api/home`, { headers }),
        fetch(`${API_URL}/api/relationships`, { headers }),
        fetch(`${API_URL}/api/wellness`, { headers }),
      ]);
      if (f.ok) setFinance(await f.json());
      if (s.ok) setStudy(await s.json());
      if (h.ok) setHome(await h.json());
      if (r.ok) setPeople(await r.json());
      if (w.ok) setWellness(await w.json());
    } catch (e) { /* نتجاهل */ }
    setLoaded(true);
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);

  const post = async (url, body) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || 'error'); }
      setMsg(lang === 'ar' ? '✅ تم الحفظ' : '✅ Saved');
      setTimeout(() => setMsg(''), 2000);
      await loadAll();
    } catch (e) { setMsg('⚠️ ' + e.message); }
  };
  const toggleHome = async (id, status) => {
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API_URL}/api/home/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ status }) });
      await loadAll();
    } catch (e) { /* نتجاهل */ }
  };

  const L = (ar, en) => (lang === 'ar' ? ar : en);
  const tabs = [
    { id: 'overview', label: L('◈ نظرة شاملة', '◈ Overview') },
    { id: 'finance', label: L('💰 المال', '💰 Finance') },
    { id: 'study', label: L('📚 الدراسة', '📚 Study') },
    { id: 'home', label: L('🏠 البيت', '🏠 Home') },
    { id: 'relations', label: L('🤝 العلاقات', '🤝 Relations') },
    { id: 'wellness', label: L('🧘 الصحة', '🧘 Wellness') },
  ];
  const panel = { padding: '1.3rem' };
  const btn = { padding: '10px 16px', background: 'linear-gradient(90deg,#0077ff,#00e5ff)', color: '#001018', border: 'none', borderRadius: '3px', fontWeight: 800, cursor: 'pointer' };

  if (!loaded) return <p style={{ color: 'var(--muted)' }}>⏳ {L('جاري تحميل حياتك...', 'Loading your life...')}</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {tabs.map((tb) => (
          <button key={tb.id} onClick={() => setTab(tb.id)} style={{
            padding: '9px 16px', borderRadius: '3px', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
            border: tab === tb.id ? '1px solid var(--cyan)' : '1px solid rgba(0,229,255,0.15)',
            background: tab === tb.id ? 'rgba(0,229,255,0.12)' : 'transparent',
            color: tab === tb.id ? 'var(--cyan)' : 'var(--muted)',
          }}>{tb.label}</button>
        ))}
      </div>
      {msg && <div style={{ padding: '0.7rem 1rem', borderRadius: '4px', background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.3)', color: '#00e676', fontSize: '0.9rem' }}>{msg}</div>}

      {tab === 'overview' && (
        <div className="glass-panel hud-panel" style={{ ...panel, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', justifyItems: 'center' }}>
          <Gauge value={finance.summary.balance} max={Math.max(finance.summary.income, 1)} label={L('الرصيد', 'Balance')} color={finance.summary.balance >= 0 ? '#00e676' : '#ff2d78'} suffix="$" />
          <Gauge value={Math.round(study.total_minutes / 60)} max={40} label={L('ساعات الدراسة', 'Study Hours')} color="#00e5ff" suffix={hs} />
          <Gauge value={home.tasks.filter((t) => t.status !== 'done').length} max={20} label={L('مهام البيت', 'Home Tasks')} color="#f59e0b" />
          <Gauge value={people.people.length} max={20} label={L('العلاقات', 'People')} color="#7c4dff" />
          <Gauge value={wellness.logs[0]?.mood || 0} max={10} label={L('المزاج', 'Mood')} color="#00e676" suffix="/10" />
        </div>
      )}

      {tab === 'finance' && (
        <div className="glass-panel hud-panel" style={panel}>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--muted)' }}>
            <span>{L('الدخل:', 'Income:')} <strong style={{ color: '#00e676' }}>${finance.summary.income}</strong></span>
            <span>{L('المصاريف:', 'Expenses:')} <strong style={{ color: '#ff2d78' }}>${finance.summary.expense}</strong></span>
            <span>{L('الرصيد:', 'Balance:')} <strong style={{ color: finance.summary.balance >= 0 ? '#00e676' : '#ff2d78' }}>${finance.summary.balance}</strong></span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.8rem', marginBottom: '1rem' }}>
            <select value={finForm.type} onChange={(e) => setFinForm({ ...finForm, type: e.target.value })} style={fieldStyle}>
              <option value="expense">{L('مصروف', 'Expense')}</option>
              <option value="income">{L('دخل', 'Income')}</option>
            </select>
            <input type="number" placeholder={L('المبلغ', 'Amount')} value={finForm.amount} onChange={(e) => setFinForm({ ...finForm, amount: e.target.value })} style={fieldStyle} />
            <input placeholder={L('الفئة', 'Category')} value={finForm.category} onChange={(e) => setFinForm({ ...finForm, category: e.target.value })} style={fieldStyle} />
            <button style={btn} onClick={() => { if (Number(finForm.amount) > 0) post('/api/finance', finForm); }}>➕</button>
          </div>
          {finance.entries.slice(0, 8).map((e) => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(0,229,255,0.08)', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text)' }}>{e.category}{e.note ? ` — ${e.note}` : ''}</span>
              <span style={{ color: e.type === 'income' ? '#00e676' : '#ff2d78', fontFamily: 'Orbitron' }}>{e.type === 'income' ? '+' : '-'}${e.amount}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'study' && (
        <div className="glass-panel hud-panel" style={panel}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.8rem', marginBottom: '1rem' }}>
            <input placeholder={L('المادة', 'Subject')} value={studyForm.subject} onChange={(e) => setStudyForm({ ...studyForm, subject: e.target.value })} style={fieldStyle} />
            <input type="number" placeholder={L('الدقائق', 'Minutes')} value={studyForm.duration_minutes} onChange={(e) => setStudyForm({ ...studyForm, duration_minutes: e.target.value })} style={fieldStyle} />
            <button style={btn} onClick={() => { if (studyForm.subject.trim()) post('/api/study', studyForm); }}>➕ {L('تسجيل جلسة', 'Log Session')}</button>
          </div>
          {study.sessions.slice(0, 8).map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(0,229,255,0.08)', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text)' }}>{s.subject}</span>
              <span style={{ color: '#00e5ff', fontFamily: 'Orbitron' }}>{s.duration_minutes}m</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'home' && (
        <div className="glass-panel hud-panel" style={panel}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.8rem', marginBottom: '1rem' }}>
            <input placeholder={L('المهمة', 'Task')} value={homeForm.title} onChange={(e) => setHomeForm({ ...homeForm, title: e.target.value })} style={fieldStyle} />
            <input placeholder={L('الغرفة', 'Room')} value={homeForm.room} onChange={(e) => setHomeForm({ ...homeForm, room: e.target.value })} style={fieldStyle} />
            <button style={btn} onClick={() => { if (homeForm.title.trim()) post('/api/home', homeForm); }}>➕</button>
          </div>
          {home.tasks.map((tk) => (
            <div key={tk.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px solid rgba(0,229,255,0.08)' }}>
              <span style={{ color: tk.status === 'done' ? 'var(--muted)' : 'var(--text)', textDecoration: tk.status === 'done' ? 'line-through' : 'none', fontSize: '0.9rem' }}>
                {tk.priority === 'urgent' ? '🔴' : tk.priority === 'high' ? '🟠' : '🔵'} {tk.title}
              </span>
              <button onClick={() => toggleHome(tk.id, tk.status === 'done' ? 'pending' : 'done')}
                style={{ background: 'none', border: `1px solid ${tk.status === 'done' ? '#00e676' : 'rgba(0,229,255,0.3)'}`, color: tk.status === 'done' ? '#00e676' : 'var(--muted)', borderRadius: '3px', padding: '3px 10px', cursor: 'pointer', fontSize: '0.75rem' }}>
                {tk.status === 'done' ? '↩️' : '✓'}
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'relations' && (
        <div className="glass-panel hud-panel" style={panel}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.8rem', marginBottom: '1rem' }}>
            <input placeholder={L('الاسم', 'Name')} value={relForm.person_name} onChange={(e) => setRelForm({ ...relForm, person_name: e.target.value })} style={fieldStyle} />
            <select value={relForm.relation_type} onChange={(e) => setRelForm({ ...relForm, relation_type: e.target.value })} style={fieldStyle}>
              <option value="family">{L('عائلة', 'Family')}</option>
              <option value="friend">{L('صديق', 'Friend')}</option>
              <option value="colleague">{L('زميل', 'Colleague')}</option>
            </select>
            <button style={btn} onClick={() => { if (relForm.person_name.trim()) post('/api/relationships', relForm); }}>➕</button>
          </div>
          {people.people.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0', borderBottom: '1px solid rgba(0,229,255,0.08)', fontSize: '0.9rem' }}>
              <span style={{ color: 'var(--text)' }}>{p.relation_type === 'family' ? '👨👩‍👦' : p.relation_type === 'friend' ? '🤝' : '💼'} {p.person_name}</span>
              <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{L('كل', 'every')} {p.contact_frequency_days} {L('يوم', 'days')}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'wellness' && (
        <div className="glass-panel hud-panel" style={panel}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.8rem', marginBottom: '1rem' }}>
            <div><label style={labelStyle}>{L('المزاج', 'Mood')}: {wellForm.mood}/10</label>
              <input type="range" min="1" max="10" value={wellForm.mood} onChange={(e) => setWellForm({ ...wellForm, mood: e.target.value })} style={{ width: '100%' }} /></div>
            <div><label style={labelStyle}>{L('الطاقة', 'Energy')}: {wellForm.energy}/10</label>
              <input type="range" min="1" max="10" value={wellForm.energy} onChange={(e) => setWellForm({ ...wellForm, energy: e.target.value })} style={{ width: '100%' }} /></div>
            <div><label style={labelStyle}>{L('النوم (ساعات)', 'Sleep (hrs)')}</label>
              <input type="number" min="0" max="14" step="0.5" value={wellForm.sleep_hours} onChange={(e) => setWellForm({ ...wellForm, sleep_hours: e.target.value })} style={fieldStyle} /></div>
            <button style={btn} onClick={() => post('/api/wellness', wellForm)}>📝 {L('سجّل', 'Log')}</button>
          </div>
          {wellness.logs.slice(0, 7).map((w) => (
            <div key={w.id} style={{ display: 'flex', gap: '1rem', padding: '0.5rem 0', borderBottom: '1px solid rgba(0,229,255,0.08)', fontSize: '0.8rem', color: 'var(--muted)' }}>
              <span>😊 {w.mood}/10</span><span>⚡ {w.energy}/10</span><span>😴 {w.sleep_hours}{hs}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ========== التطبيق ========== */
function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [page, setPage] = useState('dashboard');
  const [commitments, setCommitments] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const fetchCommitments = useCallback(async () => {
    if (!session) { setCommitments([]); return; }
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/commitments`, { headers });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر جلب الالتزامات');
      setCommitments(data.commitments || []);
    } catch (err) { console.error(err.message); }
  }, [session]);

  useEffect(() => { fetchCommitments(); }, [fetchCommitments]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCommitments([]);
    setPage('dashboard');
  };

  if (!authReady) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>⏳ عَقْل يتحقق من الهوية...</div>;
  if (!session) return (<><FloatingLangButton /><AuthScreen /></>);

  const displayName = session.user.user_metadata?.full_name?.trim() || session.user.email;

  return (
    <Layout page={page} setPage={setPage} displayName={displayName} onLogout={handleLogout}>
      {page === 'dashboard' && <MindChamber commitments={commitments} />}      
      {page === 'investigate' && <InvestigatePage commitments={commitments} onSaved={fetchCommitments} />}
      {page === 'commitments' && <CommitmentsPage commitments={commitments} refresh={fetchCommitments} />}
      {page === 'history' && <HistoryPage />}
      {page === 'chat' && <ChatPage />}
      {page === 'goals' && <GoalsPage />}
      {page === 'reports' && <ReportsPage />}
      {page === 'achievements' && <AchievementsPage />}
      {page === 'profile' && <ProfilePage displayName={displayName} email={session.user.email} onLogout={handleLogout} />}
      {page === 'lifeos' && <LifeOSPage />}
    </Layout>
  );
}

function AppRoot() {
  return (
    <LangProvider>
      <App />
    </LangProvider>
  );
}

export default AppRoot;