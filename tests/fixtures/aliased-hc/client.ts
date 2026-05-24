// `hc` imported under an alias. The detector should follow the symbol
// through the alias and treat `createClient<T>(...)` as a Hono RPC call.
import { hc as createClient } from "hono/client";

import type { AppType } from "./server.ts";

export const widgetClient = createClient<AppType>("http://localhost");

export const list = async () => widgetClient.widgets.$get();
export const create = async () => widgetClient.widgets.$post({ json: {} });
