import { Router } from 'express';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function taskFields(body, partial = false) {
  const result = {};
  if (!partial || Object.hasOwn(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) throw new Error('عنوان المهمة مطلوب (حتى ٢٠٠ حرف).');
    result.title = body.title.trim();
  }
  if (Object.hasOwn(body, 'notes')) { if (typeof body.notes !== 'string' || body.notes.length > 4000) throw new Error('ملاحظات المهمة لا تتجاوز ٤٠٠٠ حرف.'); result.notes = body.notes; }
  if (Object.hasOwn(body, 'due_date')) {
    const date = body.due_date;
    if (date !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('تاريخ الاستحقاق غير صالح.');
    result.due_date = date;
  }
  if (Object.hasOwn(body, 'completed')) { if (typeof body.completed !== 'boolean') throw new Error('حالة الإنجاز غير صالحة.'); result.completed = body.completed; }
  return result;
}
export function createTasksRouter({ requireAuth, supabase }) {
  const router = Router(); router.use(requireAuth);
  router.get('/', async (req, res) => {
    const { data, error } = await supabase.from('personal_tasks').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(500);
    if (error) return res.status(503).json({ error: 'تعذّر تحميل المهام. تأكد من تشغيل ملف إعداد المهام في Supabase.' });
    res.json({ tasks: data });
  });
  router.post('/', async (req, res) => {
    let fields; try { fields = taskFields(req.body || {}); } catch (error) { return res.status(400).json({ error: error.message }); }
    if (!uuid(req.body.id)) return res.status(400).json({ error: 'Invalid task ID' });
    const record = { ...fields, id: req.body.id, user_id: req.user.id };
    const { data, error } = await supabase.from('personal_tasks').insert(record).select().single();
    if (error?.code === '23505') {
      const existing = await supabase.from('personal_tasks').select('*').eq('id', record.id).eq('user_id', req.user.id).maybeSingle();
      if (existing.data) return res.json({ task: existing.data });
    }
    if (error) return res.status(503).json({ error: 'تعذّر حفظ المهمة. جرّب مجددًا.' });
    res.status(201).json({ task: data });
  });
  router.patch('/:id', async (req, res) => {
    if (!uuid(req.params.id)) return res.status(400).json({ error: 'Invalid task ID' });
    let fields; try { fields = taskFields(req.body || {}, true); } catch (error) { return res.status(400).json({ error: error.message }); }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'لا توجد تغييرات صالحة.' });
    const { data, error } = await supabase.from('personal_tasks').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.user.id).select().maybeSingle();
    if (error) return res.status(503).json({ error: 'تعذّر تحديث المهمة.' });
    if (!data) return res.status(404).json({ error: 'المهمة غير موجودة.' });
    res.json({ task: data });
  });
  return router;
}
