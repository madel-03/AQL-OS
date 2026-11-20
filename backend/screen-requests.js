import { Router } from 'express';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const jpeg = /^data:image\/jpeg;base64,[a-zA-Z0-9+/]+={0,2}$/;

export function createScreenRequestRouter({ requireAuth, supabase, classify }) {
  const router = Router();
  router.use(requireAuth, (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const rows = () => supabase.from('screen_requests');
  const owned = (req, query) => query.eq('user_id', req.user.id);
  const active = (req, query) => owned(req, query).gt('expires_at', new Date().toISOString());
  const reply = (res, { data, error }) => {
    if (error) return res.status(503).json({ error: 'storage_unavailable' });
    return res.json({ request: data });
  };

  router.get('/', async (req, res) => {
    const canReceive = req.query.receiver === 'true';
    const fields = canReceive ? 'id,expires_at' : 'id,expires_at,image';
    let query = active(req, rows().select(fields));
    if (canReceive) query = query.is('image', null);
    else if (typeof req.query.id === 'string' && uuid.test(req.query.id)) query = query.eq('id', req.query.id);
    else if (req.query.id !== undefined) return res.status(400).json({ error: 'invalid_request' });
    reply(res, await query.maybeSingle());
  });

  router.post('/', async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message || message.length > 240) return res.status(400).json({ error: 'invalid_request' });
    const cleanup = await owned(req, rows().delete()).lte('expires_at', new Date().toISOString());
    if (cleanup.error) return reply(res, cleanup);
    const existing = await active(req, rows().select('id')).maybeSingle();
    if (existing.error) return reply(res, existing);
    if (existing.data) return res.status(409).json({ error: 'request_exists' });
    let intent;
    try { intent = message === 'خذ لقطة من شاشة الكمبيوتر' ? 'screen_capture' : await classify(message); }
    catch { return res.status(503).json({ error: 'model_unavailable' }); }
    if (intent !== 'screen_capture') return res.status(422).json({ error: 'unsupported_request' });
    const result = await rows().insert({ user_id: req.user.id }).select('id,expires_at').single();
    if (result.error?.code === '23505') return res.status(409).json({ error: 'request_exists' });
    reply(res, result);
  });

  router.put('/:id', async (req, res) => {
    const image = req.body?.image;
    if (!uuid.test(req.params.id) || typeof image !== 'string' || image.length > 360000 || !jpeg.test(image)) {
      return res.status(400).json({ error: 'invalid_image' });
    }
    const result = await active(req, rows().update({ image })).eq('id', req.params.id).is('image', null).select('id').maybeSingle();
    if (!result.error && !result.data) return res.status(409).json({ error: 'request_expired' });
    reply(res, result);
  });

  router.delete('/:id', async (req, res) => {
    if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'invalid_request' });
    reply(res, await owned(req, rows().delete()).eq('id', req.params.id));
  });
  return router;
}
