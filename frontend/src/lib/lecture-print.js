import { lectureBlocks, lectureInline } from './lecture-reading.js';

export function printLecture(result, title, en) {
  const preview = window.open('about:blank', '_blank');
  if (!preview) return false;
  preview.opener = null;
  const doc = preview.document;
  doc.title = title;
  doc.documentElement.lang = en ? 'en' : 'ar';
  doc.documentElement.dir = en ? 'ltr' : 'rtl';
  const style = doc.createElement('style');
  style.textContent = 'body{font:16px/1.7 Arial,sans-serif;max-width:850px;margin:32px auto;padding:0 20px;color:#202735} h1,h2,h3{break-after:avoid} p{white-space:pre-wrap;overflow-wrap:anywhere} button{font:inherit;padding:6px 16px}h2{border-bottom:1px solid #cbd5e1;padding-bottom:5px;margin-top:26px}p{margin:0 0 10px}.item{border-inline-start:2px solid #64748b;padding-inline-start:12px;margin:12px 0}.answer{margin-inline-start:10px}bdi{font-size:.85em;color:#475569} @page{size:A4;margin:18mm} @media print{body{margin:0;padding:0}button{display:none}}';
  doc.head.append(style);
  const add = (tag, text) => {
    const element = doc.createElement(tag);
    element.textContent = text;
    doc.body.append(element);
    return element;
  };
  const rich = (tag, text, parent = doc.body) => {
    const element = doc.createElement(tag);
    for (const part of lectureInline(text)) {
      if (!part.tag) element.append(doc.createTextNode(part.text));
      else {
        const inline = doc.createElement(part.tag);
        inline.textContent = part.text;
        element.append(inline);
      }
    }
    parent.append(element);
    return element;
  };
  const renderText = text => {
    for (const block of lectureBlocks(text)) {
      if (block.type === 'item') {
        const item = add('div', '');
        item.className = 'item';
        rich('p', (block.number ? block.number + '. ' : '• ') + block.text, item);
        if (block.answer) {
          const answer = rich('p', block.answer, item);
          answer.className = 'answer';
        }
      } else rich(block.type === 'heading' ? 'h3' : 'p', block.text);
    }
  };
  add('button', en ? 'Print / Save as PDF' : 'طباعة / حفظ كملف PDF').onclick = () => preview.print();
  add('h1', title);
  const headings = en ? ['Summary', 'Explanation', 'Questions and answers', 'Review notes', 'Limitations', 'Models', 'Extracted source notes'] : ['الملخص', 'الشرح', 'أسئلة وإجابات', 'ملاحظات المراجع', 'حدود التحليل', 'النماذج', 'النص المستخرج'];
  const sections = [result.summary, result.explanation, result.questions, result.reviewNotes, result.warnings.join('\n'), result.models.join('\n')];
  sections.forEach((text, index) => {
    if (!text) return;
    add('h2', headings[index]);
    renderText(text);
  });
  add('h2', headings[6]);
  for (const { ref, text } of result.sources) {
    add('h3', ref);
    renderText(text);
  }
  return true;
}
