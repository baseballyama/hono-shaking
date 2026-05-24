import { hc } from "hono/client";

import type { AppType } from "./server.ts";

export const thingsClient = hc<AppType>("http://localhost");
