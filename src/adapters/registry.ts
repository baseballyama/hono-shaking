import type { FrameworkAdapter } from "./adapter.ts";
import { createSvelteAdapter } from "./svelte.ts";
import { createVueAdapter } from "./vue.ts";

/**
 * Try to load every built-in adapter. Each adapter returns `null` when its
 * optional peer dependency (svelte2tsx, @vue/compiler-sfc, …) isn't
 * installed; we silently filter those out so a TypeScript-only project
 * doesn't need to install framework packages it doesn't use.
 */
export const loadBuiltinAdapters = async (): Promise<FrameworkAdapter[]> => {
  const candidates = await Promise.all([createSvelteAdapter(), createVueAdapter()]);
  return candidates.filter((a): a is FrameworkAdapter => a != null);
};
