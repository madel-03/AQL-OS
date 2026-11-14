// Real AI only; this script never calls Google Calendar or creates an appointment.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { planCalendarRequest } from '../calendar-planning.js';
const generate = async (system, user) => {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'openai/gpt-oss-120b', temperature: .2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }), signal: AbortSignal.timeout(45000) });
  assert.equal(response.status, 200, `AI HTTP ${response.status}`);
  const data = await response.json(); const text = data.choices[0].message.content;
  return text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
};
const options = { generate, lang: 'ar', timeZone: 'Asia/Riyadh', now: Date.parse('2026-11-13T19:00:00Z') };
const clear = await planCalendarRequest({ ...options, message: 'أضف موعد بكرة الساعة الخامسة مساءً لمراجعة المشروع لمدة نصف ساعة' });
assert.equal(clear.kind, 'event'); assert.equal(clear.event.start, '2026-11-14T14:00:00.000Z'); assert.equal(Date.parse(clear.event.end) - Date.parse(clear.event.start), 1800000);
const ambiguous = await planCalendarRequest({ ...options, message: 'أضف موعد بكرة الساعة الخامسة لمراجعة المشروع' });
assert.equal(ambiguous.kind, 'clarify');
const followup = await planCalendarRequest({ ...options, context: ['أضف موعد لمراجعة المشروع'], message: 'بكرة الخامسة مساءً' });
assert.equal(followup.kind, 'event'); assert.equal(followup.event.start, '2026-11-14T14:00:00.000Z');
console.log('PASS: actual AI resolved tomorrow at 5 PM in Riyadh, honored a 30-minute duration, asked about ambiguous AM/PM, and understood a follow-up. No Google calls or events were made.');

for (const message of ['Schedule a gym session starting five minutes from now for thirty minutes', 'حط لي النادي بعد خمس دقائق لمدة نص ساعة']) {
  const plan = await planCalendarRequest({ ...options, message });
  assert.equal(plan.kind, 'event'); assert.equal(plan.event.start, new Date(options.now + 300000).toISOString()); assert.equal(Date.parse(plan.event.end) - Date.parse(plan.event.start), 1800000);
}
console.log('PASS: real AI gym scheduling in English and Arabic uses exact five-minute server offsets.');
