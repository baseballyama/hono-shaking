import { hc } from "hono/client";

import type { AppType } from "./server.ts";

export const itemsClient = hc<AppType>("http://localhost");

interface Deps {
  itemsClient: typeof itemsClient;
}

// `deps.itemsClient.items.$get()` — the hc variable sits in the middle of the
// chain, not at the root. The chain truncator should still find it.
export const list = async (deps: Deps) => {
  return deps.itemsClient.items.$get();
};

export const detail = async (deps: Deps, id: string) => {
  return deps.itemsClient.items[":id"].$get({ param: { id } });
};
