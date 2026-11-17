import test from 'node:test';
import assert from 'node:assert/strict';
import { documentIntent, dailyDocument } from '../src/lib/assistant-documents.js';
test('explicit document requests route without intercepting questions, schedule writes or negations', () => {
  for(const text of ['طلع لي تقرير اليوم','يا جارفس طلعلي ملخص اليوم','ورني ايش عندي اليوم','show my daily report']) assert.equal(documentIntent(text),'today',text);
  assert.equal(documentIntent('طلع لي مهامي'),'tasks'); assert.equal(documentIntent('افتح آخر تقرير'),'latest-report');
  for(const text of ['وش عندي اليوم','لا تطلع لي تقرير اليوم','أضف موعد اليوم','ارسل تقرير اليوم','اعرض لي كيف اضيف موعد']) assert.equal(documentIntent(text),null,text);
});
test('daily document uses real snapshot data, excludes future tasks and marks unavailable data', () => {
  const snapshot={day:'2026-11-17',calendar:{connected:true},errors:{},events:[{title:'اجتماع فعلي',start:{dateTime:'2026-11-17T12:00:00+03:00'}}],tasks:[{title:'مستحقة',due_date:'2026-11-17',completed:false},{title:'قادمة',due_date:'2026-11-20',completed:false},{title:'منتهية',due_date:'2026-11-17',completed:true}]};
  const report=dailyDocument(snapshot).report;assert.ok(report.includes('اجتماع فعلي'));assert.ok(report.includes('مستحقة'));assert.ok(!report.includes('قادمة'));assert.ok(!report.includes('منتهية'));
  assert.ok(dailyDocument(snapshot,false,'tasks').report.includes('قادمة'));
  const failed=dailyDocument({...snapshot,events:[],errors:{calendar:'error',tasks:'error'}}).report;assert.ok(failed.includes('غير مكتمل'));assert.ok(!failed.includes('لا توجد مواعيد'));
});
