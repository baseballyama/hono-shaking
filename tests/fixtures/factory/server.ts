import { Hono } from 'hono';

const app = new Hono()
  .get('/orgs', (c) => c.json([]))
  .post('/orgs', (c) => c.json({}))
  .delete('/orgs/:id', (c) => c.json({}));

export type AppType = typeof app;
