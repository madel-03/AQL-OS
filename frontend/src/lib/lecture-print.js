export function printLecture(result, title, en) {
  const preview = window.open('about:blank', '_blank');
  if (!preview) return false;
  preview.opener = null;
  const doc = preview.document;
  doc.title = title;
  doc.documentElement.lang = en ? 'en' : 'ar';
  doc.documentElement.dir = en ? 'ltr' : 'rtl';
  const style = doc.createElement('style');
  style.textContent = 'body{font:16px/1.7 Arial,sans-serif;max-width:850px;margin:32px auto;padding:0 20px;color:#202735} h1,h2,h3{break-after:avoid} p{white-space:pre-wrap;overflow-wrap:anywhere} button{font:inherit;padding:6px 16px} @page{size:A4;margin:18mm} @media print{body{margin:0;padding:0}button{display:none}}';
  doc.head.append(style);
  const add = (tag, text) => {
    const element = doc.createElement(tag);
    element.textContent = text;
    doc.body.append(element);
    return element;
  };
  add('button', en ? 'Print / Save as PDF' : 'طباعة / حفظ كملف PDF').onclick = () => preview.print();
  add('h1', title);
  const headings = en ? ['Summary', 'Explanation', 'Questions and answers', 'Review notes', 'Limitations', 'Models', 'Extracted source notes'] : ['الملخص', 'الشرح', 'أسئلة وإجابات', 'ملاحظات المراجع', 'حدود التحليل', 'النماذج', 'النص المستخرج'];
  const sections = [result.summary, result.explanation, result.questions, result.reviewNotes, result.warnings.join('\n'), result.models.join('\n')];
  sections.forEach((text, index) => {
    if (!text) return;
    add('h2', headings[index]);
    add('p', text);
  });
  add('h2', headings[6]);
  for (const { ref, text } of result.sources) {
    add('h3', ref);
    add('p', text);
  }
  return true;
}
