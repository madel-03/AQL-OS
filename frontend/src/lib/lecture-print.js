import { studySections, studyMap } from './lecture-study.js';
import { lectureInline } from './lecture-reading.js';

export function printLecture(result, title, en) {
  const preview = window.open('about:blank', '_blank');
  if (!preview) return false;
  preview.opener = null;
  const doc = preview.document;
  doc.title = title;
  doc.documentElement.lang = en ? 'en' : 'ar';
  doc.documentElement.dir = en ? 'ltr' : 'rtl';
  const style = doc.createElement('style');
  style.textContent = 'body{font:16px/1.7 Arial,sans-serif;max-width:850px;margin:32px auto;padding:0 20px;color:#202735} h1,h2,h3{break-after:avoid} p{white-space:pre-wrap;overflow-wrap:anywhere} button{font:inherit;padding:6px 16px}h2{border-bottom:1px solid #cbd5e1;padding-bottom:5px;margin-top:26px}p{margin:0 0 10px}.item{border-inline-start:2px solid #64748b;padding-inline-start:12px;margin:12px 0}.answer{margin-inline-start:10px}bdi{font-size:.85em;color:#475569} .concept-map{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 30px;padding-inline-start:28px}.concept-map li{border:1px solid #94bbb5;border-radius:6px;padding:7px;break-inside:avoid} @page{size:A4;margin:18mm} @media print{body{margin:0;padding:0}button{display:none}}';
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
  const renderBlocks = blocks => {
    for (const block of blocks) {
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
  if (result.isDraft) add('p', en ? 'Draft awaiting review' : 'مسودة بانتظار المراجعة');
  const map = studyMap(result, en);
  if (map.length > 1) {
    add('h2', en ? 'Concept map' : 'خريطة المفاهيم');
    const list = add('ol', '');
    list.className = 'concept-map';
    for (const label of map) rich('li', label, list);
  }
  for (const section of studySections(result, en)) {
    if (!section.blocks.length) continue;
    add('h2', section.title);
    renderBlocks(section.blocks);
  }
  return true;
}
