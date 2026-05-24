import { Hono } from "hono";

const app = new Hono()
  .get("/posts", (c) => c.json([]))
  .post("/posts", (c) => c.json({}))
  .get("/posts/:id", (c) => c.json({}));

export type AppType = typeof app;
