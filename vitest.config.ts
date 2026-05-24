import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Fixtures are loaded synchronously and TS-Program creation can take a few
    // seconds per scenario. The default 5s timeout is too tight.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
