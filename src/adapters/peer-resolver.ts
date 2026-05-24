// Adapter peer deps (`svelte2tsx`, `@vue/compiler-sfc`) live in the *user's*
// project, not next to this package. When invoked via `pnpm dlx` or `npx`,
// this package is installed in an isolated temporary directory that does not
// have the user's deps, so a bare `import('svelte2tsx')` resolves nothing.
//
// We work around that by asking Node to resolve the module *as if* requested
// from the current working directory, which is the user's project root. If
// that fails we fall back to a bare import for users who installed the peer
// dep next to us (unusual, but possible).

import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const importPeer = async (specifier: string): Promise<unknown> => {
  try {
    // The path passed to createRequire only has to exist *conceptually* — Node
    // uses it as the resolution origin. We deliberately point at a sibling
    // filename inside cwd so resolution starts from `<cwd>/node_modules`.
    const requireFromCwd = createRequire(resolve(process.cwd(), "__hono_shaking_peer__"));
    const resolvedPath = requireFromCwd.resolve(specifier);
    return await import(pathToFileURL(resolvedPath).href);
  } catch {
    return await import(specifier);
  }
};
