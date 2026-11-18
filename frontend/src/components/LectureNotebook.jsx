import { useState } from 'react';

const guide = {
  ar: 'اشرح المحاضرة بالعربية بأسلوب بسيط. ابدأ بالفكرة الرئيسية، ثم فسّر المصطلحات الصعبة مع أمثلة. اذكر الصفحة أو التوقيت إذا كان واضحًا في المصدر، وميّز الأمثلة التوضيحية عن محتوى المحاضرة. اختم بثلاثة أسئلة للمراجعة.',
  en: 'Explain the lecture in plain English. Start with the main idea, then explain difficult concepts with examples. Cite page numbers or timestamps when supported by the source, distinguish illustrative examples from lecture content, and finish with three review questions.',
};

export default function LectureNotebook({ en, result, title }) {
  const [status, setStatus] = useState('');
  const [manual, setManual] = useState(null);
  const copy = async (value, success) => {
    setManual(null);
    setStatus('');
    try {
      await navigator.clipboard.writeText(value);
      setStatus(success);
    } catch {
      setManual(value);
      setStatus(en ? 'Select and copy the text below.' : 'حدّد النص أدناه وانسخه.');
    }
  };
  const source = result?.sources?.length
    ? [title, en ? 'Notes extracted by AQL; references may be approximate.' : 'ملاحظات استخرجها عقل؛ قد تكون المراجع تقريبية.', ...result.sources.map(({ ref, text }) => ref + '\n' + text)].join('\n\n')
    : '';
  return (
    <details className="lecture-notebook">
      <summary>{en ? 'Audio or video explanation in NotebookLM' : 'شرح صوتي أو فيديو في NotebookLM'}</summary>
      <p>{en
        ? 'Open NotebookLM with your Google account. Add the original PDF or audio, or a public YouTube link. In Studio, choose Audio Overview or Video Overview. For a local video, use the extracted notes below after analysis.'
        : 'افتح NotebookLM بحساب Google. أضف ملف PDF أو تسجيل الصوت الأصلي، أو رابط YouTube عام. من Studio اختر الملخص الصوتي أو ملخص الفيديو. إذا كان الفيديو ملفًا على جهازك، تقدر تستخدم الملاحظات المستخرجة أدناه بعد التحليل.'}</p>
      <div className="services-reminder-actions">
        <a className="services-open" href="https://notebook.google.com/" target="_blank" rel="noopener noreferrer">{en ? 'Open NotebookLM ↗' : 'افتح NotebookLM ↗'}</a>
        <button type="button" className="studio-text-button" onClick={() => copy(guide[en ? 'en' : 'ar'], en ? 'Instructions copied. Paste them into the Studio customization prompt.' : 'نسخت تعليمات الشرح. الصقها في إعدادات التخصيص داخل Studio.')}>{en ? 'Copy explanation instructions' : 'انسخ تعليمات الشرح'}</button>
        {source && <button type="button" className="studio-text-button" onClick={() => copy(source, en ? 'Notes copied. Add them as Copied text in NotebookLM.' : 'نسخت الملاحظات. أضفها كمصدر «نص منسوخ» في NotebookLM.')}>{en ? 'Copy extracted notes' : 'انسخ ملاحظات المحاضرة'}</button>}
      </div>
      <small>{en ? 'You add sources yourself. Generation uses your NotebookLM plan limits.' : 'أنت تضيف المصدر بنفسك. التوليد يستخدم حصة حسابك في NotebookLM.'}</small>
      {status && <p role="status">{status}</p>}
      {manual !== null && <textarea className="music-search-input" rows={5} readOnly value={manual} onFocus={event => event.target.select()} aria-label={en ? 'Text to copy' : 'النص المراد نسخه'} />}
    </details>
  );
}
