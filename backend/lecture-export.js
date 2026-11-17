import { exportPdf, exportDocx } from './report-export.js';
export function lectureExportJob(body) {
  const data = body?.result; const en = body?.lang === 'en';
  if (!data || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) throw new Error('عنوان المحاضرة غير صالح.');
  for (const field of ['summary', 'explanation', 'questions', 'reviewNotes']) if (typeof data[field] !== 'string' || !data[field].trim() || data[field].length > 40000) throw new Error('نتيجة المحاضرة ناقصة أو كبيرة جدًا.');
  if (!Array.isArray(data.sources) || data.sources.length > 80 || !Array.isArray(data.warnings) || data.warnings.length > 20 || !Array.isArray(data.models) || data.models.length > 10) throw new Error('مراجع المحاضرة غير صالحة.');
  let total = 0;
  for (const unit of data.sources) { if (typeof unit.ref !== 'string' || unit.ref.length > 100 || typeof unit.text !== 'string') throw new Error('المصدر غير صالح.'); total += unit.text.length; }
  if (total > 60000 || [...data.warnings, ...data.models].some(x => typeof x !== 'string' || x.length > 2000)) throw new Error('محتوى المحاضرة كبير جدًا.');
  const titles = en ? ['Summary', 'Explanation', 'Practice questions and answers', 'Review notes', 'Limitations', 'AI models', 'Extracted source notes'] : ['الملخص', 'الشرح', 'أسئلة وإجابات للمراجعة', 'ملاحظات المراجع', 'حدود التحليل', 'نماذج الذكاء', 'النص المستخرج'];
  // Keep user/model text out of generated heading syntax and always preserve all sections.
  const title = body.title.replace(/[\r\n#]/g, ' ').trim();
  const sections = [data.summary, data.explanation, data.questions, data.reviewNotes, data.warnings.join('\n\n') || (en ? 'Verify the original lecture; AI may make mistakes.' : 'راجع المحاضرة الأصلية؛ قد تخطئ النماذج.'), data.models.join('\n\n'), data.sources.map(x => `### ${x.ref.replace(/[\r\n#]/g, ' ')}\n\n${x.text}`).join('\n\n')];
  return { topic: title, lang: en ? 'en' : 'ar', kind: 'lecture', sources: [], report: `# ${title}\n\n${en ? 'Study notes with explanation, summary and practice questions based on the uploaded lecture.' : 'مذكرة دراسية تشمل شرح المحاضرة وملخصها وأسئلة للمراجعة اعتمادًا على المحتوى المرفوع.'}\n\n${sections.map((text, i) => `## ${titles[i]}\n\n${text}`).join('\n\n')}` };
}
export async function exportLecture(body) {
  const job = lectureExportJob(body);
  if (!['pdf', 'docx', 'md'].includes(body.format)) throw new Error('صيغة التنزيل غير مدعومة.');
  if (body.format === 'md') return { bytes: Buffer.from(job.report), mime: 'text/markdown; charset=utf-8', extension: 'md' };
  return { bytes: await (body.format === 'pdf' ? exportPdf(job) : exportDocx(job)), mime: body.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: body.format };
}
