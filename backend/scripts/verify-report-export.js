import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { exportDocx, exportPdf, reportHtml } from '../report-export.js';

const sources = [{ id: 1, url: 'https://www.energy.gov/', title: 'Department of Energy' }];
const paragraph = 'الطاقة الشمسية مصدر متجدد، وتختلف جدواها بحسب الموقع والتكلفة. نراجع الأدلة المتاحة ونوضّح حدود المقارنة قبل اتخاذ القرار. تدعم هذه الفقرة اختبار اتصال الحروف العربية واتجاه النص المختلط مع English والأرقام 123. [1]';
const table = '| الخيار | المميزات | الحدود |\n| --- | --- | --- |\n| الألواح الشمسية | توليد الكهرباء | تحتاج إلى ضوء الشمس |\n| البطاريات | تخزين الطاقة | تكلفة إضافية |';
const arabic = { lang: 'ar', topic: 'تقرير الطاقة الشمسية', sources, report: `# تقرير الطاقة الشمسية\n\nهذا مستند تجريبي لفحص التصدير وليس بحثًا منشورًا.\n\n## الخلاصة\n\n${paragraph}\n\n## مقارنة الخيارات\n\n${table}\n\n## النتائج\n\n${Array.from({ length: 12 }, () => `- ${paragraph}`).join('\n\n')}\n\n## المصادر\n\n[1] وزارة الطاقة\nhttps://www.energy.gov/` };
const english = { lang: 'en', topic: 'Research export', sources, report: '# Research export\n\nThis fixture checks English paragraphs, links and page layout.\n\n## Findings\n\n- A finding with a clickable citation [1].\n\n## Comparison\n\n| Option | Benefit | Limitation |\n| --- | --- | --- |\n| Solar panels | Generate electricity | Depend on sunlight |\n\n## Sources\n\n[1] Department of Energy\nhttps://www.energy.gov/' };
assert(!reportHtml({ ...english, report: '<script>alert(1)</script>' }, '').includes('<script>'));
assert(reportHtml(english, '').includes('href="https://www.energy.gov/"'));
await fs.mkdir('data/export-qa', { recursive: true });
for (const [name, job] of [['arabic', arabic], ['english', english]]) {
  for (const [extension, create] of [['docx', exportDocx], ['pdf', exportPdf]]) {
    console.log('Creating', name, extension);
    const file = await create(job);
    assert(file.length > 1000);
    assert.equal(file.subarray(0, extension === 'pdf' ? 4 : 2).toString(), extension === 'pdf' ? '%PDF' : 'PK');
    await fs.writeFile(`data/export-qa/${name}.${extension}`, file);
    console.log('PASS', name, extension, file.length);
  }
}
