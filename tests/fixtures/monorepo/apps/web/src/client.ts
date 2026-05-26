import { hc } from "hono/client";

import type { AppType } from "../../api/src/index.ts";

export const backendClient = hc<AppType>("http://localhost");

export const listUsers = async () => {
  const res = await backendClient.api.v1.users.$get();
  return res.json();
};

// /api/v1/users POST is intentionally not called — the config's `ignore`
// list should leave it as "unused" (i.e. NOT ignore it), so the test can
// assert that scoped routes are still detected as unused.
