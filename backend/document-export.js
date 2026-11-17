import { Router, json } from 'express';
import { exportPdf, exportDocx } from './report-export.js';
export function createDocumentExportRouter({ requireAuth }) {
  const router = Router(); let running = 0;
  router.post('/export', requireAuth, json({ limit: '1mb' }), async (req, res) => {
    const { title, report, lang, format, sources = [] } = req.body || {};
    if (typeof title !== 'string' || !title.trim() || title.length > 500 || typeof report !== 'string' || !report.trim() || report.length > 250000 || !['pdf','docx','md'].includes(format) || !Array.isArray(sources) || sources.length > 100) return res.status(400).json({ error: 'Invalid document' });
    if (sources.some(x => !x || !Number.isInteger(x.id) || typeof x.url !== 'string' || x.url.length > 2000)) return res.status(400).json({ error: 'Invalid sources' });
    if (running >= 2) return res.status(429).json({ error: 'Export busy' }); running++;
    try {
      const job = { topic: title, report, lang: lang === 'en' ? 'en' : 'ar', sources, kind: 'document' };
      const bytes = format === 'md' ? Buffer.from(report) : await (format === 'pdf' ? exportPdf(job) : exportDocx(job));
      res.setHeader('Cache-Control','no-store'); res.setHeader('Content-Disposition',`attachment; filename="aql-document.${format}"`);
      res.type(format === 'pdf' ? 'application/pdf' : format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/markdown; charset=utf-8').send(bytes);
    } catch { res.status(500).json({ error: 'Could not export document' }); } finally { running--; }
  }); return router;
}
