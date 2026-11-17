import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { lectureExportJob, exportLecture } from './lecture-export.js';
import { reportHtml } from './report-export.js';
export const sample = { title: 'مذكرة محاضرة الطاقة', lang: 'ar', result: { summary: 'الطاقة محفوظة في النظام المعزول [صفحة 1].', explanation: 'الطاقة الحركية تعتمد على الكتلة ومربع السرعة.\n\nمثال توضيحي: جسم كتلته 2 kg وسرعته 3 m/s طاقته 9 J [صفحة 1].', questions: 'ما قانون الطاقة الحركية؟\nالإجابة: E = 0.5 × m × v².', reviewNotes: 'راجعت الشرح مقابل النص المستخرج؛ يلزم مطابقة المعادلات مع الأصل.', warnings: ['توقيت المراجع قد يكون تقريبيًا.'], models: ['Gemini', 'Groq'], sources: [{ ref: 'صفحة 1', text: 'الطاقة لا تفنى ولا تستحدث في النظام المعزول.' }] } };
test('all formats preserve sections and source notes; invalid payloads fail', async () => {
  const job = lectureExportJob(sample); assert.equal(job.kind, 'lecture');
  for (const text of ['الملخص','الشرح','أسئلة وإجابات','ملاحظات المراجع','النص المستخرج','Gemini','Groq','صفحة 1']) assert.ok(job.report.includes(text));
  const md = await exportLecture({ ...sample, format: 'md' }); assert.equal(md.extension, 'md'); assert.equal(md.bytes.toString(), job.report);
  const docx = await exportLecture({ ...sample, format: 'docx' }); const files = unzipSync(docx.bytes); const xml = strFromU8(files['word/document.xml']); assert.ok(xml.includes('w:bidi')); assert.ok(xml.includes('الطاقة محفوظة')); assert.ok(xml.includes('w:val="Title"')); assert.ok(xml.includes('النص المستخرج'));
  assert.throws(() => lectureExportJob({ ...sample, result: { ...sample.result, explanation: '' } }));
  await assert.rejects(exportLecture({ ...sample, format: 'exe' }));
  const html = reportHtml({ ...job, report: '# Test\n<script>alert(1)</script>' }, ''); assert.ok(!html.includes('<script>')); assert.ok(html.includes('مذكرة محاضرة'));
});

test('export endpoint requires auth and returns complete Markdown and Word as attachments', async t => {
  const { default: express } = await import('express'); const { createLecturesRouter } = await import('./lectures.js');
  const app = express(); app.use(express.json({ limit: '1mb' })); app.use('/api/lectures', createLecturesRouter({ requireAuth: (req, res, next) => req.get('Authorization') === 'Bearer qa' ? (req.user = { id: 'qa' }, next()) : res.sendStatus(401) }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/lectures/export`; const options = format => ({ method: 'POST', headers: { Authorization: 'Bearer qa', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...sample, format }) });
  assert.equal((await fetch(url, { ...options('md'), headers: { 'Content-Type': 'application/json' } })).status, 401);
  for (const format of ['md', 'docx']) { const response = await fetch(url, options(format)); assert.equal(response.status, 200); assert.ok(response.headers.get('content-disposition').includes(`aql-lecture.${format}`)); const bytes = Buffer.from(await response.arrayBuffer()); assert.ok(bytes.length > 100); if (format === 'md') assert.ok(bytes.toString().includes('النص المستخرج')); else assert.equal(bytes.subarray(0, 2).toString(), 'PK'); }
  assert.equal((await fetch(url, options('exe'))).status, 400);
});
