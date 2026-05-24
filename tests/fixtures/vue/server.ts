import { Hono } from 'hono';

const app = new Hono()
  .get('/things', (c) => c.json([]))
  .put('/things/:id', (c) => c.json({}))
  .delete('/things/:id', (c) => c.json({}));

export type AppType = typeof app;
