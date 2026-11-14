import { normalizeVoice } from './wake-listener.js';
export function voiceIntent(text) {
  const value = normalizeVoice(text);
  if (/^(وقف الاستماع|اوقف الاستماع|وقف المايك|stop listening|stop microphone)$/.test(value)) return { type: 'stop' };
  if (/^(افتح|open)\s+/.test(value)) {
    const routes = { tasks: ['مهام', 'tasks'], calendar: ['تقويم', 'calendar'], projects: ['مشاريع', 'projects'], device: ['جهاز', 'device'], chat: ['محادث', 'chat', 'مساعد'] };
    for (const [id, words] of Object.entries(routes)) if (words.some(word => value.includes(word))) return { type: 'navigate', id };
  }
  if (/^(?:اكد المهمة|احفظ المهمة|نفذ المهمة|confirm (?:the )?task)$/.test(value)) return { type: 'task-confirm' };
  if (/^(?:الغ طلب المهمة|الغي طلب المهمة|cancel (?:the )?task request)$/.test(value)) return { type: 'task-cancel' };
  if (/(مهمه|مهمة|task)/.test(value) && /(اضف|ضيف|حط|انشئ|سجل|جهز|علم|خلصت|انجز|منجز|add|create|complete|finish|done|mark)/.test(value)) return { type: 'task-prepare' };
  if (/^(?:نعم )?(?:اكد(?: لي)? (?:الموعد|الحفظ)|احفظ(?: لي)? الموعد|نفذ(?: لي)? الموعد|confirm (?:the )?(?:event|appointment))(?: (?:لو سمحت|من فضلك|please))?$/.test(value)) return { type: 'calendar-confirm' };
  if (/^(الغ طلب الموعد|الغي طلب الموعد|الغ الموعد|الغي الموعد|cancel (the )?(event|appointment)( request)?)$/.test(value)) return { type: 'calendar-cancel' };
  const advice = /^(?:how (?:do|can|should) i|كيف (?:اقدر|اضيف|احجز|اسوي))(?:\s|$)/.test(value);
  const readQuery = /\b(?:what(?: s| is)|show|tell|list)\b|^(?:وش|ايش|اعرض|متي|متى)(?:\s|$)/.test(value);
  const calendarAction = /\b(?:add|create|schedule|book|insert|put|plan)\b|(?:اضف|تضيف|ضيف|احجز|حجز|حدد|حط|سجل|رتب|انشئ|جهز|جدول)/.test(value);
  const calendarSubject = /(?:موعد|اجتماع|تقويم)|\b(?:calendar|appointment|meeting|session|workout)\b/.test(value);
  const scheduledTime = /(?:بعد|بكره|بكرة|غدا|الساعة)|\b(?:tomorrow|tonight|today|from now|in (?:\d+|five|ten|fifteen|thirty|an?|one|two) (?:minutes?|hours?)|at \d)\b/.test(value);
  if (!advice && !readQuery && calendarAction && (calendarSubject || scheduledTime)) return { type: 'calendar-prepare' };
  if (/^(اضف|احذف|عدل|انشئ|شغل|ارسل|سجل|add|delete|edit|create|run|send|schedule)(?:\s|$)/.test(value)) return { type: 'review-required' };
  if (/(اليوم|today)/.test(value) && /(وش|ايش|ماذا|عندي|جدول|مواعيد|مهام|what|schedule|agenda|appointments|tasks)/.test(value)) return { type: 'today' };
  if (/^(مهامي|المهام|مواعيدي|المواعيد|my tasks|my appointments|my schedule)$/.test(value)) return { type: 'today' };
  return { type: 'chat' };
}
export function spokenToday(snapshot, en = false) {
  if (!snapshot) return en ? 'I could not refresh your day. Please try again.' : 'ما قدرت أحدّث بيانات يومك. جرّب مرة ثانية.';
  const { tasks = [], events = [], calendar, errors = {}, day } = snapshot;
  const due = tasks.filter(task => !task.completed && task.due_date && task.due_date <= day).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const parts = [en ? 'Here is your day.' : 'هذا اللي عندك اليوم.'];
  if (errors.calendar) parts.push(en ? 'Your calendar could not be read, so I cannot confirm your appointments.' : 'تعذّرت قراءة التقويم، فما أقدر أؤكد مواعيدك.');
  else if (!calendar?.connected) parts.push(en ? 'Your Google calendar is not connected yet.' : 'تقويم Google غير مربوط إلى الآن.');
  else {
    parts.push(en ? `You have ${events.length} appointments today.` : `عندك ${events.length} مواعيد اليوم.`);
    for (const event of events.slice(0, 4)) {
      const time = event.start.date ? (en ? 'all day' : 'طوال اليوم') : new Intl.DateTimeFormat(en ? 'en' : 'ar', { timeStyle: 'short' }).format(new Date(event.start.dateTime));
      parts.push(`${event.title}، ${time}.`);
    }
    if (events.length > 4) parts.push(en ? 'The remaining appointments are in your calendar.' : 'وباقي المواعيد تلقاها في التقويم.');
  }
  if (errors.tasks) parts.push(en ? 'Your tasks could not be read.' : 'تعذّرت قراءة المهام.');
  else {
    parts.push(en ? `${due.length} tasks are due today or overdue.` : `وعندك ${due.length} مهام مستحقة اليوم أو متأخرة.`);
    for (const task of due.slice(0, 4)) parts.push(`${task.title}${task.due_date < day ? (en ? ', overdue' : '، متأخرة') : ''}.`);
    if (due.length > 4) parts.push(en ? 'The rest are in your task list.' : 'وباقي المهام تلقاها في قائمتك.');
  }
  return parts.join(' ');
}
