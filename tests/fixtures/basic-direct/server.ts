import { Hono } from 'hono';

const app = new Hono()
  .get('/users', (c) => c.json({ users: [] }))
  .get('/users/:id', (c) => c.json({ id: c.req.param('id') }))
  .put('/users/:id', (c) => c.json({ ok: true }))
  .post('/users', (c) => c.json({ ok: true }))
  .delete('/dead/route', (c) => c.json({ ok: true }));

export type AppType = typeof app;
