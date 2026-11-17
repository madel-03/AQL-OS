import { normalizeVoice, wakeMatch } from './wake-listener.js';
export function documentIntent(text) {
  const value = normalizeVoice(wakeMatch(text, 'جارفس') ?? text);
  const display = /^(?:(?:ممكن|لو سمحت|طيب|please|can you)\s+)*(?:طلع|طلعلي|طلع لي|تطلع|اطلع|جيب|اظهر|اريد|ابي|ابغا|ابغي|ابغى|ورني|وريني|اعرض|افتح|جهز|سو|سوي|show|open|prepare|make)(?:\s|$)/.test(value);
  if (!display || /(?:احذف|امسح|ارسل|delete|send)/.test(value)) return null;
  if (/(?:اخر|آخر|latest|last)/.test(value) && /(?:تقرير|بحث|report|research)/.test(value)) return 'latest-report';
  if (/(?:مهامي|المهام|tasks)/.test(value) && !/(?:اضف|ضيف|add|create|اكد|confirm)/.test(value)) return 'tasks';
  if (/(?:اليوم|يومي|today|daily)/.test(value) && /(?:تقرير|ملخص|جدول|عندي|يومي|report|summary|schedule|agenda)/.test(value)) return 'today';
  return null;
}
export function requestDocument(text, en = false, signal) {
  const kind = documentIntent(text); if (!kind) return Promise.resolve(null);
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false; let timer;
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(result); };
    const abort = () => finish(null); signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(en ? 'The document could not open. Try again.' : 'تعذّر فتح المستند. أعد المحاولة.'), 90000);
    window.dispatchEvent(new CustomEvent('aql-document-request', { detail: { kind, en, signal, finish } }));
  });
}
export function dailyDocument(snapshot, en = false, kind = 'today') {
  if (!snapshot) throw new Error(en ? 'Could not refresh account data.' : 'تعذّر تحديث بيانات حسابك.');
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const title = kind === 'tasks' ? (en ? 'Your remaining tasks' : 'تقرير مهامك المتبقية') : (en ? 'Your daily report' : 'تقرير يومك');
  const lines = [`# ${title}`, `${snapshot.day} · ${timeZone}`, en ? 'Prepared from your connected account data. No changes were made.' : 'أُعدّ من بيانات حسابك المرتبطة. لم تُعدّل أي مهام أو مواعيد.'];
  const due = snapshot.tasks.filter(x => !x.completed && (kind === 'tasks' || (x.due_date && x.due_date <= snapshot.day)));
  if (kind !== 'tasks') {
    lines.push(en ? '## Appointments today' : '## مواعيد اليوم');
    if (snapshot.errors?.calendar) lines.push(en ? 'Calendar could not be loaded. This section is incomplete.' : 'تعذّرت قراءة التقويم. هذا القسم غير مكتمل.');
    else if (!snapshot.calendar?.connected) lines.push(en ? 'Google Calendar is not connected.' : 'تقويم Google غير مربوط.');
    else if (!snapshot.events.length) lines.push(en ? 'No appointments today.' : 'لا توجد مواعيد اليوم.');
    else for (const event of [...snapshot.events].sort((a,b) => String(a.start.dateTime || a.start.date).localeCompare(String(b.start.dateTime || b.start.date)))) {
      const time = event.start.date ? (en ? 'All day' : 'طوال اليوم') : new Intl.DateTimeFormat(en ? 'en' : 'ar', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(event.start.dateTime));
      lines.push(`- ${time} — ${event.title}`);
    }
  }
  lines.push(en ? '## Tasks' : '## المهام');
  if (snapshot.errors?.tasks) lines.push(en ? 'Tasks could not be loaded. This section is incomplete.' : 'تعذّرت قراءة المهام. هذا القسم غير مكتمل.');
  else if (!due.length) lines.push(en ? 'No remaining tasks in this view.' : 'لا توجد مهام متبقية في هذا العرض.');
  else for (const task of due.sort((a,b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))) lines.push(`- ${task.title} — ${task.due_date || (en ? 'No due date' : 'دون تاريخ')}${task.due_date && task.due_date < snapshot.day ? (en ? ' · Overdue' : ' · متأخرة') : ''}`);
  lines.push(en ? '## Data notes' : '## ملاحظات البيانات', kind === 'tasks' ? (en ? 'Includes all incomplete tasks, including future and undated tasks.' : 'يشمل كل المهام غير المكتملة، بما فيها المستقبلية ودون تاريخ.') : (en ? 'Tasks shown are due today or overdue. Future and undated tasks are excluded.' : 'المهام المعروضة مستحقة اليوم أو متأخرة؛ لا تشمل المستقبلية أو التي بلا تاريخ.'), en ? 'This is a live data snapshot, not an AI assessment of productivity.' : 'هذه لقطة من البيانات الحالية، وليست تقييمًا بالذكاء الاصطناعي لإنتاجيتك.');
  return { title: `${title} ${snapshot.day}`, report: lines.join('\n\n'), lang: en ? 'en' : 'ar', sources: [] };
}
