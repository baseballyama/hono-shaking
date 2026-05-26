import { defineConfig } from "../../../src/config.ts";

// Monorepo-style config at the repo root. Patterns without a leading `/` are
// resolved relative to this directory, so `apps/api/src/index.ts` targets the
// server in the API package.
export default defineConfig({
  ignore: {
    routes: [
      {
        method: "POST",
        path: "/api/v1/webhooks/**",
        serverAppTypeFile: "apps/api/src/index.ts",
        reason: "Webhook — invoked by external systems, not via hc",
      },
    ],
    orphans: null,
  },
});
