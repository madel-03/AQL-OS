import { createContext, useContext } from 'react';

export const ResearchContext = createContext(null);
export const useResearch = () => useContext(ResearchContext);
export const taskFinished = (status) => ['completed', 'failed'].includes(status);
export const taskStages = ['queued', 'planning', 'searching', 'reading', 'writing', 'reviewing', 'completed'];
export const stageLabels = (en) => en
  ? { queued: 'Queued', planning: 'Planning', searching: 'Searching', reading: 'Reading sources', writing: 'Writing', reviewing: 'Checking references', completed: 'Ready', failed: 'Needs attention' }
  : { queued: 'في الانتظار', planning: 'أخطط', searching: 'أبحث', reading: 'أقرأ المصادر', writing: 'أكتب التقرير', reviewing: 'أراجع المراجع', completed: 'جاهزة', failed: 'تحتاج متابعة' };

export const arabicResearchErrors = {
  SEARCH_UNAVAILABLE: 'لم تُرجع خدمة البحث نتائج قابلة للاستخدام. حاول بعد قليل أو بسّط الموضوع.',
  INSUFFICIENT_EVIDENCE: 'المصادر المسترجعة لا تجيب عن الموضوع بما يكفي. حدّد سؤالك أو اختر موضوعًا أوسع.',
  SOURCES_UNREADABLE: 'تعذّرت قراءة مصدرين مختلفين. بعض المواقع تمنع القراءة الآلية أو تتطلب تسجيل الدخول.',
  REPORT_INVALID: 'التقرير ناقص أو مراجعُه غير صحيحة حتى بعد محاولة إصلاحه. أعد المحاولة بالموضوع الأصلي.',
  AI_RATE_LIMIT: 'وصلت خدمة الذكاء الاصطناعي إلى حد الطلبات. انتظر قليلًا ثم أعد المحاولة.',
  AI_CONFIGURATION: 'رفض مزوّد الذكاء الاصطناعي الطلب. يلزم فحص إعداداته في الخادم.',
  TIMEOUT: 'انتهت مهلة أحد الطلبات. أعد المحاولة بالموضوع الأصلي.',
  AI_UNAVAILABLE: 'تعذّر إكمال الطلب لدى مزوّد الذكاء الاصطناعي. حاول بعد قليل.',
  SERVER_RESTARTED: 'أُعيد تشغيل الخادم أثناء المهمة. أعد المحاولة بالموضوع الأصلي.',
};
