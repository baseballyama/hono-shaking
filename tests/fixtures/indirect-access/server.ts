import { Hono } from 'hono';

const app = new Hono().get('/items', (c) => c.json([])).get('/items/:id', (c) => c.json({}));

export type AppType = typeof app;
