import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType } from 'docx';

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const safeUrl = (value) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; } };

export function reportBlocks(markdown) {
  const lines = String(markdown).replace(/^\uFEFF/, '').split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim(); if (!line) continue;
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      const rows = [cells(line)]; i++;
      while (lines[i + 1]?.includes('|') && lines[i + 1].trim()) rows.push(cells(lines[++i].trim()));
      blocks.push({ type: 'table', rows }); continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    blocks.push(heading ? { type: 'heading', level: heading[1].length, text: heading[2] } : { type: line.startsWith('- ') ? 'bullet' : 'paragraph', text: line.replace(/^- /, '') });
  }
  return blocks;
}

function inlineParts(text, sources) {
  const parts = []; const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)|\[(\d+)\]/g;
  let start = 0;
  for (const match of text.matchAll(regex)) {
    if (match.index > start) parts.push({ text: text.slice(start, match.index) });
    const source = sources.find((entry) => entry.id === Number(match[4]));
    const url = safeUrl(match[2] || match[3] || source?.url);
    parts.push({ text: match[1] || match[0], url }); start = match.index + match[0].length;
  }
  if (start < text.length) parts.push({ text: text.slice(start) });
  return parts;
}

export function reportHtml(job, font) {
  const rtl = job.lang !== 'en';
  const inline = (text) => inlineParts(text, job.sources || []).map((part) => part.url ? `<a href="${escape(part.url)}">${escape(part.text)}</a>` : escape(part.text)).join('');
  const body = reportBlocks(job.report).map((block) => {
    if (block.type === 'heading') return `<h${block.level}>${inline(block.text)}</h${block.level}>`;
    if (block.type === 'table') return `<table>${block.rows.map((row, index) => `<tr>${row.map((cell) => `<${index ? 'td' : 'th'}>${inline(cell)}</${index ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`;
    return `<p${block.type === 'bullet' ? ' class="bullet"' : ''} dir="auto">${block.type === 'bullet' ? '• ' : ''}${inline(block.text)}</p>`;
  }).join('\n');
  return `<!doctype html><html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
  @font-face{font-family:AQL;src:url(data:font/ttf;base64,${font}) format('truetype');font-weight:100 900}
  *{box-sizing:border-box}body{font-family:AQL,Arial,sans-serif;font-size:11pt;line-height:1.85;color:#202735;margin:0}h1,h2,h3{color:#000;line-height:1.5;break-after:avoid}h1{font-size:25pt;margin:0 0 20px}h2{font-size:16pt;margin:24px 0 10px}h3{font-size:13pt}p{margin:0 0 10px;overflow-wrap:anywhere;orphans:3;widows:3}a{color:#285c8b;text-decoration:underline;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;margin:14px 0;font-size:10pt;table-layout:fixed}th,td{border:1px solid #cbd5e1;padding:9px;text-align:start;vertical-align:top;overflow-wrap:anywhere}th{background:#edf1f5}tr{break-inside:avoid}thead{display:table-header-group}.bullet{padding-inline-start:12px}.brand{font-size:9pt;color:#657084;margin-bottom:18px;direction:ltr;text-align:${rtl ? 'right' : 'left'}}
  </style></head><body><div class="brand">AQL · ${rtl ? 'تقرير بحث' : 'Research report'}</div>${body}</body></html>`;
}

export async function exportPdf(job) {
  const font = await fs.readFile(new URL('./assets/fonts/NotoSansArabic.ttf', import.meta.url));
  const browser = await puppeteer.launch({ headless: true, ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}) });
  try {
    const page = await browser.newPage();
    // All content is escaped. Export never loads remote resources or executes scripts.
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request) => request.url().startsWith('data:') ? request.continue() : request.abort());
    await page.setContent(reportHtml(job, font.toString('base64')), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', right: '18mm', bottom: '22mm', left: '18mm' }, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;text-align:center;font:9px Arial;color:#697386"><span class="pageNumber"></span> / <span class="totalPages"></span></div>', timeout: 30000 }));
  } finally { await browser.close(); }
}

export async function exportDocx(job) {
  const rtl = job.lang !== 'en';
  const runs = (text) => inlineParts(text, job.sources || []).map((part) => part.url ? new ExternalHyperlink({ link: part.url, children: [new TextRun({ text: part.text, style: 'Hyperlink', rightToLeft: rtl })] }) : new TextRun({ text: part.text, rightToLeft: rtl }));
  const paragraph = (text, extra = {}) => new Paragraph({ bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 150, line: 320 }, children: runs(text), ...extra });
  const children = reportBlocks(job.report).map((block) => {
    if (block.type === 'heading') return paragraph(block.text, { heading: block.level === 1 ? HeadingLevel.TITLE : block.level === 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, keepNext: true });
    if (block.type === 'table') return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: rtl, rows: block.rows.map((row, index) => new TableRow({ tableHeader: index === 0, cantSplit: true, children: row.map((cell) => new TableCell({ shading: index === 0 ? { fill: 'EDF1F5' } : undefined, children: [paragraph(cell)] })) })) });
    return paragraph(block.text, block.type === 'bullet' ? { bullet: { level: 0 } } : {});
  });
  const document = new Document({ creator: 'AQL', title: job.topic || 'Research report',
    styles: { default: { document: { run: { font: { ascii: 'Arial', hAnsi: 'Arial', cs: 'Arial' }, size: 23, sizeComplexScript: 23, color: '202735' } } }, paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', run: { color: '000000', size: 44, sizeComplexScript: 44, bold: true } },
      { id: 'Heading1', name: 'heading 1', basedOn: 'Normal', run: { color: '000000', size: 32, sizeComplexScript: 32, bold: true } },
      { id: 'Heading2', name: 'heading 2', basedOn: 'Normal', run: { color: '000000', size: 27, sizeComplexScript: 27, bold: true } },
    ] }, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1020, bottom: 1134, left: 1020 } } }, children }] });
  return Packer.toBuffer(document);
}
