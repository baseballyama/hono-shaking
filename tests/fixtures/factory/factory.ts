import { hc } from "hono/client";

import type { AppType } from "./server.ts";

export type OrgClient = ReturnType<typeof hc<AppType>>;

// The `hc<T>(...)` call is hidden behind a factory function. Direct consumers
// of this factory shouldn't have to mention `hc<T>` themselves; auto-discovery
// has to recognize `createOrgClient` as a factory returning a binding for
// `AppType`, and pick up `const orgClient = createOrgClient(...)` consumers.
export const createOrgClient = (url: string): OrgClient => hc<AppType>(url);
