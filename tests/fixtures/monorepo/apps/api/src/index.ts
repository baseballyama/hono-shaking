import { Hono } from "hono";

const app = new Hono()
  .get("/api/v1/users", (c) => c.json({ users: [] }))
  .post("/api/v1/users", (c) => c.json({ ok: true }))
  // The webhook is hit by an external system, not by the web client. The
  // monorepo-root config is expected to suppress this as "ignored".
  .post("/api/v1/webhooks/zendesk", (c) => c.json({ ok: true }));

export type AppType = typeof app;
