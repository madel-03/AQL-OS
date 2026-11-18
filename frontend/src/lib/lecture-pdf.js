import { studySections, studyMap } from './lecture-study.js';
import { lectureBlocks, lectureInline } from './lecture-reading.js';

export function downloadLecturePdf(result, title, en) {
  return downloadReadingPdf({
    title, en,
    label: en ? 'AQL   /   STUDY NOTES' : 'عقل  /  مذكرة دراسية',
    sections: studySections(result, en),
    map: studyMap(result, en),
    draft: result.isDraft,
  });
}

export function downloadAttachmentPdf({ title, text, en, partial }) {
  return downloadReadingPdf({
    title, en,
    label: en ? 'AQL   /   FILE RESULT' : 'عقل  /  نتيجة الملف',
    notice: partial ? (en ? 'Partial result' : 'نتيجة جزئية') : '',
    sections: [{ blocks: lectureBlocks(text) }],
    map: [],
  });
}

async function downloadReadingPdf({ title, en, label, sections, map, draft, notice }) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ compress: true });
  const canvas = document.createElement('canvas');
  const width = 794, height = 1123, margin = 54;
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.scale(2, 2);
  ctx.direction = en ? 'ltr' : 'rtl';
  ctx.textAlign = en ? 'left' : 'right';
  ctx.textBaseline = 'top';
  const x = en ? margin : width - margin;
  let y, page = 0;

  const paint = (text, size, color, bold = false, inset = 0) => {
    ctx.font = (bold ? '700 ' : '') + size + 'px Arial, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(text, x + (en ? inset : -inset), y);
  };
  const reset = () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#14746f';
    ctx.fillRect(0, 0, width, 12);
    y = 42;
    paint(label, 15, '#14746f', true);
    y += 36;
  };
  const flush = () => {
    y = height - 42;
    paint(String(++page), 13, '#475569');
    if (page > 1) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, 210, 297);
  };
  const ensure = space => {
    if (y + space > height - 65) { flush(); reset(); }
  };
  const write = (text, size, color, bold = false, inset = 0) => {
    const maxWidth = width - margin * 2 - inset;
    const fits = value => {
      ctx.font = (bold ? '700 ' : '') + size + 'px Arial, sans-serif';
      return ctx.measureText(value).width <= maxWidth;
    };
    const lineHeight = Math.ceil(size * 1.55);
    const line = value => { ensure(lineHeight); paint(value, size, color, bold, inset); y += lineHeight; };
    let current = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const next = current ? current + ' ' + word : word;
      if (fits(next)) { current = next; continue; }
      if (current) line(current);
      current = '';
      for (const character of word) {
        if (current && !fits(current + character)) { line(current); current = ''; }
        current += character;
      }
    }
    if (current) line(current);
  };

  reset();
  write(title, 32, '#13253b', true);
  if (draft) write(en ? 'Draft awaiting review' : 'مسودة بانتظار المراجعة', 16, '#854d0e', true);
  if (notice) write(notice, 16, '#854d0e', true);
  if (map.length > 1) {
    ensure(42);
    y += 14;
    write(en ? 'Concept map' : 'خريطة المفاهيم', 22, '#115e59', true);
    for (const [index, label] of map.entries()) {
      ensure(70);
      ctx.fillStyle = '#edf5fa';
      ctx.fillRect(margin, y, width - 2 * margin, 55);
      y += 9;
      const start = y;
      write(String(index + 1) + ' · ' + label, 17, '#23445e', true, 14);
      y = Math.max(y + 8, start + 53);
    }
  }
  for (const [index, section] of sections.entries()) {
    if (!section.blocks.length) continue;
    ensure(105);
    y += 18;
    if (section.title) {
      ctx.fillStyle = '#e6f3f0';
      ctx.fillRect(margin, y, width - 2 * margin, 43);
      y += 9;
      paint(String(index + 1) + ' · ' + section.title, 22, '#115e59', true, 12);
      y += 47;
    }
    for (const block of section.blocks) {
      const prefix = block.type === 'item' ? (block.number ? block.number + '. ' : '• ') : '';
      ensure(55);
      write(prefix + lectureInline(block.text).map(part => part.text).join(''), 18, '#202735', block.type === 'heading' || !!block.answer, block.type === 'item' ? 12 : 0);
      if (block.answer) write(block.answer, 17, '#334155', false, 26);
      y += 9;
    }
  }
  flush();
  pdf.save(title.replace(/[<>:"/\\|?*]/g, '-').slice(0, 140) + '.pdf');
}
