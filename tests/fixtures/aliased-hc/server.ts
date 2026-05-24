import { Hono } from 'hono';

const app = new Hono()
  .get('/widgets', (c) => c.json([]))
  .post('/widgets', (c) => c.json({}))
  .delete('/widgets/:id', (c) => c.json({}));

export type AppType = typeof app;
