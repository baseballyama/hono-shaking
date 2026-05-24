import { hc } from "hono/client";

import type { AppType } from "./server.ts";

export const backendClient = hc<AppType>("http://localhost");

export const fetchUsers = async () => {
  const res = await backendClient.users.$get();
  return res.json();
};

export const createUser = async () => {
  await backendClient.users.$post({ json: { name: "a" } });
};

export const updateUser = async (id: string) => {
  await backendClient.users[":id"].$put({ param: { id } });
};
